import { readFileSync } from 'node:fs';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';

import { Server } from 'socket.io';

import type { BaseCheckpointSaver } from '@langchain/langgraph';

import type { Config } from '../config';
import { createControl, type RunControl } from '../control';
import type { RunStore } from '../durability/store';
import { EventBus } from '../events';
import { StripeSentinel, signStripePayload } from '../integrations';
import { COVERAGE_THRESHOLD } from '../sandbox/types';
import type {
  AgentStatusPayload,
  ArtifactsPayload,
  DeployUpdatePayload,
  FirstSalePayload,
  MemoryRetrievalPayload,
  RevenueUpdatePayload,
  SocialPostPayload,
} from '../types';
import type { MemoryProvider } from '../memory/provider';
import { BRAIN_VERSION } from '../version';
import {
  parseAgentStatus,
  parseArtifacts,
  parseDeployUpdate,
  parseFirstSale,
  parseMemoryRetrieval,
  parseRevenueUpdate,
  parseSocialPost,
} from './contract';

export interface BrainServer {
  io: Server;
  httpServer: HttpServer | HttpsServer;
  port: number;
  url: string;
  control: RunControl;
  close(): Promise<void>;
}

export interface SocketServerOptions {
  /** Sentinel Stripe bersama (idempoten lintas webhook & run otonom). */
  sentinel?: StripeSentinel;
  /** Vector memory — untuk menyertakan jumlah vektor per namespace di snapshot. */
  memory?: MemoryProvider;
  /** Run history + event log durable (PRD v3.0 §4.4). */
  store?: RunStore;
  /** Checkpointer durable — run dari socket ikut bisa di-resume setelah restart. */
  checkpointer?: BaseCheckpointSaver;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
    req.on('end', () => resolve(data));
  });
}

/**
 * Realtime protocol — PRD §2.1 (WebSockets + polling fallback, WSS di produksi)
 * dan PRD §5 (skema event agent:status_update / milestone:first_sale).
 *
 * Endpoint: ws://localhost:4800/brain-server
 * Loop Controls: event `control:halt`/`control:resume` + HTTP POST /control/halt
 */
export async function startSocketServer(
  config: Config,
  bus: EventBus,
  opts: SocketServerOptions = {},
): Promise<BrainServer> {
  const control = createControl();
  const controlTelemetry = { tokensUsed: 0, latencyMs: 0, model: config.llmDriver };
  const sentinel = opts.sentinel ?? new StripeSentinel(config.stripeWebhookSecret);

  // Status terakhir tiap agen + milestone + integrasi — dipakai snapshot saat (re)connect.
  const latestByAgent = new Map<string, AgentStatusPayload>();
  const latestMilestones: FirstSalePayload[] = [];
  let latestDeploy: DeployUpdatePayload | null = null;
  let latestRevenue: RevenueUpdatePayload | null = null;
  const latestSocial: SocialPostPayload[] = [];
  const latestRetrievals: MemoryRetrievalPayload[] = [];
  let latestArtifacts: ArtifactsPayload | null = null;
  const memory = opts.memory;
  const store = opts.store;

  // Setelah webhook Stripe diterima → siarkan revenue metrics yang sudah diperbarui.
  function broadcastRevenue(runId: string): void {
    const metrics = sentinel.metrics();
    bus.revenue({ ...metrics, runId, timestamp: new Date().toISOString() });
  }

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ ok: true, service: 'autooffice3d-brain', control: control.snapshot() }),
      );
      return;
    }
    if (req.method === 'POST' && (req.url === '/control/halt' || req.url === '/control/resume')) {
      void readBody(req).then((body) => {
        let runId: string | undefined;
        try {
          const parsed: unknown = body ? JSON.parse(body) : {};
          if (parsed && typeof parsed === 'object' && 'runId' in parsed) {
            const value = (parsed as { runId?: unknown }).runId;
            if (typeof value === 'string') runId = value;
          }
        } catch {
          runId = undefined;
        }
        if (req.url === '/control/halt') control.halt(runId);
        else control.resume(runId);
        io.emit('control:state', control.snapshot());
        bus.agent(
          EventBus.payload({
            runId: 'control',
            agentId: 'founder_agent',
            action: 'idle',
            zone: 'central_bus',
            logMessage: `LOOP CONTROLS · ${req.url === '/control/halt' ? 'HALT' : 'RESUME'} ${runId ?? 'ALL'} via HTTP`,
            telemetry: controlTelemetry,
          }),
        );
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, control: control.snapshot() }));
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/webhook/stripe') {
      // Stripe Webhook Sentinel (PRD §3.4) — verifikasi signature HMAC SHA-256
      // lalu terjemahkan transaksi pertama jadi milestone:first_sale + revenue.
      void readBody(req).then((body) => {
        const sig = (req.headers['stripe-signature'] as string | undefined) ?? '';
        const sale = sentinel.receive(body, sig, 'webhook');
        if (sale) bus.milestone(sale);
        broadcastRevenue(sale?.runId ?? 'webhook');
        res.writeHead(sentinel.lastSignatureVerified || !config.stripeWebhookSecret ? 200 : 401, {
          'content-type': 'application/json',
        });
        res.end(
          JSON.stringify({
            ok: true,
            received: true,
            signatureVerified: sentinel.lastSignatureVerified,
            firstSale: Boolean(sale),
            metrics: sentinel.metrics(),
          }),
        );
      });
      return;
    }
    res.writeHead(404).end();
  };

  // WSS: sertifikat TLS disediakan lewat env (BRAIN_TLS_CERT / BRAIN_TLS_KEY) —
  // tanpa sertifikat server tetap jalan ws:// (dev lokal), dengan sertifikat → wss://.
  const tlsCert = process.env.BRAIN_TLS_CERT;
  const tlsKey = process.env.BRAIN_TLS_KEY;
  const useTls = Boolean(tlsCert && tlsKey);
  const httpServer = useTls
    ? createHttpsServer(
        { cert: readFileSync(tlsCert as string), key: readFileSync(tlsKey as string) },
        handler,
      )
    : createServer(handler);

  const io = new Server(httpServer, {
    path: config.socketPath,
    cors: { origin: '*' },
    // WebSocket dulu; bila gagal (jaringan memblokir) otomatis jatuh ke long-polling.
    transports: ['websocket', 'polling'],
    pingInterval: 10_000,
    pingTimeout: 5_000,
  });

  const offAgent = bus.onAgent((payload) => {
    const parsed = parseAgentStatus(payload);
    if (!parsed.ok) {
      console.warn(`[brain] agent:status_update DITOLAK (skema tidak valid): ${parsed.issues}`);
      return;
    }
    latestByAgent.set(parsed.payload.agentId, parsed.payload);
    io.emit('agent:status_update', parsed.payload);
  });
  const offMilestone = bus.onMilestone((payload) => {
    const parsed = parseFirstSale(payload);
    if (!parsed.ok) {
      console.warn(`[brain] milestone:first_sale DITOLAK (skema tidak valid): ${parsed.issues}`);
      return;
    }
    latestMilestones.push(parsed.payload);
    io.emit('milestone:first_sale', parsed.payload);
  });
  const offDeploy = bus.onDeploy((payload) => {
    const parsed = parseDeployUpdate(payload);
    if (!parsed.ok) {
      console.warn(`[brain] deploy:update DITOLAK (skema tidak valid): ${parsed.issues}`);
      return;
    }
    latestDeploy = parsed.payload;
    io.emit('deploy:update', parsed.payload);
  });
  const offRevenue = bus.onRevenue((payload) => {
    const parsed = parseRevenueUpdate(payload);
    if (!parsed.ok) {
      console.warn(`[brain] revenue:update DITOLAK (skema tidak valid): ${parsed.issues}`);
      return;
    }
    latestRevenue = parsed.payload;
    io.emit('revenue:update', parsed.payload);
  });
  const offSocial = bus.onSocial((payload) => {
    const parsed = parseSocialPost(payload);
    if (!parsed.ok) {
      console.warn(`[brain] social:post DITOLAK (skema tidak valid): ${parsed.issues}`);
      return;
    }
    latestSocial.push(parsed.payload);
    io.emit('social:post', parsed.payload);
  });
  const offRetrieval = bus.onRetrieval((payload) => {
    const parsed = parseMemoryRetrieval(payload);
    if (!parsed.ok) {
      console.warn(`[brain] memory:retrieval DITOLAK (skema tidak valid): ${parsed.issues}`);
      return;
    }
    latestRetrievals.push(parsed.payload);
    io.emit('memory:retrieval', parsed.payload);
  });
  const offArtifacts = bus.onArtifacts((payload) => {
    const parsed = parseArtifacts(payload);
    if (!parsed.ok) {
      console.warn(`[brain] artifacts:ready DITOLAK (skema tidak valid): ${parsed.issues}`);
      return;
    }
    latestArtifacts = parsed.payload;
    io.emit('artifacts:ready', parsed.payload);
  });

  io.on('connection', (socket) => {
    socket.emit('system:hello', {
      service: 'brain',
      version: BRAIN_VERSION,
      drivers: {
        llm: config.llmDriver,
        memory: config.memoryDriver,
        sandbox: config.sandboxDriver,
        deploy: config.deployDriver,
        github: config.githubToken ? 'github' : 'local',
        email: config.emailDriver,
        social: config.socialDriver,
        stripe: config.stripeWebhookSecret ? 'webhook' : 'simulate',
      },
      limits: {
        maxIterations: config.maxIterations,
        tokenBudget: config.tokenBudget,
        coverageThreshold: COVERAGE_THRESHOLD,
      },
      durability: {
        dataDir: config.dataDir,
        memory: config.memoryDriver,
        runs: store ? store.listRuns(20).length : 0,
      },
      loopControls: { endpoint: 'control:halt | control:resume', state: control.snapshot() },
      socketPath: config.socketPath,
      history: bus.history.slice(-50),
    });

    // Snapshot on-demand: klien (re)connect menarik state terakhir sekali —
    // dipakai Theater untuk memulihkan viewport tanpa menunggu event berikutnya.
    socket.on('state:request', async (ack?: (r: unknown) => void) => {
      const memorySizes = memory ? await memory.sizes().catch(() => ({})) : {};
      const snapshot = {
        agents: [...latestByAgent.values()],
        milestones: latestMilestones.slice(-1),
        deploy: latestDeploy,
        revenue: latestRevenue,
        social: latestSocial.slice(-6),
        retrieval: latestRetrievals.slice(-20),
        artifacts: latestArtifacts,
        memory: memorySizes,
        runs: store ? store.listRuns(20) : [],
        control: control.snapshot(),
        generatedAt: new Date().toISOString(),
      };
      socket.emit('state:snapshot', snapshot);
      ack?.({ ok: true, snapshot });
    });

    // SIMULATE WEBHOOK (kartu 💳) — demo transaksi $29 tanpa Stripe nyata.
    socket.on('stripe:simulate', (input: unknown, ack?: (r: unknown) => void) => {
      const runId =
        (input as { runId?: unknown } | undefined)?.runId &&
        typeof (input as { runId?: unknown }).runId === 'string'
          ? (input as { runId: string }).runId
          : 'simulated_run';
      const event = {
        id: `evt_sim_${Date.now().toString(36)}`,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            amount_total: 2900,
            currency: 'usd',
            customer: `cus_sim_${Math.floor(Math.random() * 1e6)}`,
            customer_details: {
              email: 'demo.buyer@founderscaled.io',
              address: { city: 'San Francisco', country: 'US' },
            },
          },
        },
      };
      const rawBody = JSON.stringify(event);
      const sig = signStripePayload(rawBody, config.stripeWebhookSecret ?? 'whsec_offline');
      const sale = sentinel.receive(rawBody, sig, runId);
      if (sale) bus.milestone(sale);
      broadcastRevenue(runId);
      ack?.({
        ok: true,
        signatureVerified: sentinel.lastSignatureVerified,
        firstSale: Boolean(sale),
        metrics: sentinel.metrics(),
      });
    });

    // Ping round-trip untuk badge PING xxms (PRD §2.1) — klien minta echo,
    // latensi = waktu sampai ack kembali.
    socket.on('sys:ping', (ack?: (r: unknown) => void) => {
      ack?.({ t: Date.now() });
    });

    socket.on('control:halt', (input: unknown, ack?: (r: unknown) => void) => {
      const runId = (input as { runId?: unknown } | undefined)?.runId;
      control.halt(typeof runId === 'string' && runId ? runId : undefined);
      bus.agent(
        EventBus.payload({
          runId: typeof runId === 'string' && runId ? runId : 'control',
          agentId: 'founder_agent',
          action: 'idle',
          zone: 'central_bus',
          logMessage: 'LOOP CONTROLS · HALT GRAPH pressed by operator',
          telemetry: controlTelemetry,
        }),
      );
      io.emit('control:state', control.snapshot());
      ack?.({ ok: true, control: control.snapshot() });
    });

    socket.on('control:resume', (input: unknown, ack?: (r: unknown) => void) => {
      const runId = (input as { runId?: unknown } | undefined)?.runId;
      control.resume(typeof runId === 'string' && runId ? runId : undefined);
      bus.agent(
        EventBus.payload({
          runId: typeof runId === 'string' && runId ? runId : 'control',
          agentId: 'founder_agent',
          action: 'discussing',
          zone: 'central_bus',
          logMessage: 'LOOP CONTROLS · RESUME pressed by operator',
          telemetry: controlTelemetry,
        }),
      );
      io.emit('control:state', control.snapshot());
      ack?.({ ok: true, control: control.snapshot() });
    });

    // Daftar run durable (post-restart) — Theater dapat menampilkan run history.
    socket.on('run:list', (input: unknown, ack?: (r: unknown) => void) => {
      const limit = (input as { limit?: unknown } | undefined)?.limit;
      const runs = store?.listRuns(typeof limit === 'number' && limit > 0 ? limit : 20) ?? [];
      ack?.({ ok: true, runs });
    });

    // Resume run yang terputus (mis. daemon/VPS restart) dari checkpoint SQLite.
    socket.on('run:resume', async (input: unknown, ack?: (r: unknown) => void) => {
      const runId = (input as { runId?: unknown } | undefined)?.runId;
      if (typeof runId !== 'string' || runId.length === 0) {
        ack?.({ ok: false, error: 'runId required' });
        return;
      }
      ack?.({ ok: true, resuming: true, runId });
      const { resumeAutonomous } = await import('../run');
      void resumeAutonomous(runId, {
        config,
        emit: bus,
        control,
        checkpointer: opts.checkpointer,
        store,
      }).catch((err: unknown) => {
        console.error(`[brain] resume ${runId} failed:`, err);
      });
    });

    socket.on('founder:directive', async (prompt: unknown, ack?: (r: unknown) => void) => {
      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        ack?.({ ok: false, error: 'empty directive' });
        return;
      }
      ack?.({ ok: true, queued: true });
      const { runAutonomous } = await import('../run');
      void runAutonomous(prompt, {
        config,
        emit: bus,
        control,
        checkpointer: opts.checkpointer,
        store,
      }).catch((err: unknown) => {
        console.error('[brain] autonomous run failed:', err);
      });
    });
  });

  const port = config.port;
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, () => resolve());
  });

  return {
    io,
    httpServer,
    port,
    control,
    url: `${useTls ? 'wss' : 'ws'}://localhost:${port}${config.socketPath}`,
    async close() {
      offAgent();
      offMilestone();
      offDeploy();
      offRevenue();
      offSocial();
      offRetrieval();
      offArtifacts();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
