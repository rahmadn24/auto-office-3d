import { readFileSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { createServer } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';

import { Server } from 'socket.io';

import type { BaseCheckpointSaver } from '@langchain/langgraph';

import type { BriefingService } from '../briefing';
import type { Config } from '../config';
import { createControl, type RunControl } from '../control';
import type { RunStore } from '../durability/store';
import { EventBus } from '../events';
import { createPayment, type PaymentProvider } from '../payments';
import { COVERAGE_THRESHOLD } from '../sandbox/types';
import type {
  AgentStatusPayload,
  ArtifactsPayload,
  ChatTurnPayload,
  DeployUpdatePayload,
  FirstSalePayload,
  MemoryRetrievalPayload,
  RevenueUpdatePayload,
  SocialPostPayload,
} from '../types';
import type { MemoryProvider } from '../memory/provider';
import { BRAIN_VERSION } from '../version';
import { createHttpHandler } from './http';
import {
  parseAgentStatus,
  parseArtifacts,
  parseBrief,
  parseChatTurn,
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
  /** Driver pembayaran aktif (Payment Sentinel multi-provider, PRD §3.4). */
  payment?: PaymentProvider;
  /** Vector memory — untuk menyertakan jumlah vektor per namespace di snapshot. */
  memory?: MemoryProvider;
  /** Run history + event log durable (PRD v3.0 §4.4). */
  store?: RunStore;
  /** Checkpointer durable — run dari socket ikut bisa di-resume setelah restart. */
  checkpointer?: BaseCheckpointSaver;
  /** Briefing Room (Fase 8) — founder:chat → pm:reply + compile brief (GO). */
  briefing?: BriefingService;
}

/**
 * Realtime protocol — PRD §2.1 (WebSockets + polling fallback, WSS di produksi)
 * dan PRD §5 (skema event agent:status_update / milestone:first_sale).
 *
 * Endpoint: ws://localhost:4800/brain-server
 * Loop Controls: event `control:halt`/`control:resume` + HTTP POST /control/halt
 * HTTP surface (health/control/webhook) dipecah ke `server/http.ts` (Fase 9).
 */
export async function startSocketServer(
  config: Config,
  bus: EventBus,
  opts: SocketServerOptions = {},
): Promise<BrainServer> {
  const control = createControl();
  const controlTelemetry = { tokensUsed: 0, latencyMs: 0, model: config.llmDriver };
  const payment = opts.payment ?? createPayment(config);

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
  const briefing = opts.briefing;

  // Metrik revenue yang sudah diperbarui disiarkan setelah webhook/simulasi (PRD §3.4).
  function broadcastRevenue(runId: string): void {
    bus.revenue({ ...payment.metrics(), runId, timestamp: new Date().toISOString() });
  }

  // HTTP surface (health/control/webhook/demo) — hasil pemecahan Fase 9 ke server/http.ts.
  const handler = createHttpHandler({
    bus,
    control,
    payment,
    controlTelemetry,
    getIo: () => io,
  });

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
        payment: config.paymentDriver,
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

    // SIMULATE PAYMENT (kartu 💳) — demo transaksi $29 tanpa akun gateway.
    // Driver aktif yang menentukan format event (stripe/midtrans/stub).
    socket.on('payment:simulate', (input: unknown, ack?: (r: unknown) => void) => {
      const runId =
        (input as { runId?: unknown } | undefined)?.runId &&
        typeof (input as { runId?: unknown }).runId === 'string'
          ? (input as { runId: string }).runId
          : 'simulated_run';
      if (!payment.simulateSale) {
        ack?.({
          ok: false,
          provider: payment.id,
          error: `driver ${payment.id} tidak mendukung simulasi`,
        });
        return;
      }
      const outcome = payment.simulateSale(runId);
      if (outcome.sale) bus.milestone(outcome.sale);
      broadcastRevenue(runId);
      ack?.({
        ok: outcome.accepted,
        provider: payment.id,
        status: outcome.status,
        signatureVerified: outcome.signatureVerified,
        firstSale: Boolean(outcome.sale),
        metrics: payment.metrics(),
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

    /* ───────── Fase 8 — Briefing Room (PRD §3.1, §5.3) ───────── */

    // founder:chat { conversationId, message } → PM agent → pm:reply (broadcast).
    // Ack konsisten dengan founder:directive: langsung `queued`, balasan menyusul.
    socket.on('founder:chat', async (input: unknown, ack?: (r: unknown) => void) => {
      const rec = input as { conversationId?: unknown; message?: unknown } | null;
      const conversationId =
        typeof rec?.conversationId === 'string' ? rec.conversationId.trim() : '';
      const message = typeof rec?.message === 'string' ? rec.message.trim() : '';
      if (!briefing) {
        ack?.({ ok: false, error: 'briefing service unavailable' });
        return;
      }
      if (!conversationId || !message) {
        ack?.({ ok: false, error: 'conversationId & message required' });
        return;
      }
      ack?.({ ok: true, queued: true });
      try {
        const turn = await briefing.handleTurn({ conversationId, message });
        const parsed = parseChatTurn(turn);
        if (!parsed.ok) {
          console.warn(`[brain] pm:reply DITOLAK (skema tidak valid): ${parsed.issues}`);
          return;
        }
        io.emit('pm:reply', parsed.payload);
      } catch (err) {
        // Jangan biarkan UI tertinggal di "typing" — kirim turn error eksplisit.
        const fallback: ChatTurnPayload = {
          conversationId,
          channel: 'briefing',
          role: 'agent',
          agentId: 'pm_agent',
          message: `⚠️ gagal memproses pesan: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date().toISOString(),
        };
        io.emit('pm:reply', fallback);
      }
    });

    // Riwayat thread durable (reload/restart) — dipanggil UI saat mount/reconnect.
    socket.on('briefing:history', async (input: unknown, ack?: (r: unknown) => void) => {
      const conversationId = (input as { conversationId?: unknown } | undefined)?.conversationId;
      if (!briefing || typeof conversationId !== 'string' || conversationId.trim().length === 0) {
        ack?.({ ok: false, error: 'conversationId required' });
        return;
      }
      const turns = await briefing.history(conversationId.trim());
      ack?.({ ok: true, conversationId, turns });
    });

    // GO — compile thread jadi brief terstruktur (dipakai UI sebagai founder:directive).
    socket.on('brief:compile', async (input: unknown, ack?: (r: unknown) => void) => {
      const conversationId = (input as { conversationId?: unknown } | undefined)?.conversationId;
      if (!briefing || typeof conversationId !== 'string' || conversationId.trim().length === 0) {
        ack?.({ ok: false, error: 'conversationId required' });
        return;
      }
      try {
        const brief = await briefing.compile(conversationId.trim());
        const parsed = parseBrief(brief);
        if (!parsed.ok) {
          ack?.({ ok: false, error: `brief tidak valid: ${parsed.issues}` });
          return;
        }
        ack?.({ ok: true, brief: parsed.payload });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
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
