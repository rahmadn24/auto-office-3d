import { readFileSync } from 'node:fs';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';

import { Server } from 'socket.io';

import type { Config } from '../config';
import { createControl, type RunControl } from '../control';
import { EventBus } from '../events';
import { COVERAGE_THRESHOLD } from '../sandbox/types';
import type { AgentStatusPayload, FirstSalePayload } from '../types';
import { parseAgentStatus, parseFirstSale } from './contract';

export interface BrainServer {
  io: Server;
  httpServer: HttpServer | HttpsServer;
  port: number;
  url: string;
  control: RunControl;
  close(): Promise<void>;
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
export async function startSocketServer(config: Config, bus: EventBus): Promise<BrainServer> {
  const control = createControl();
  const controlTelemetry = { tokensUsed: 0, latencyMs: 0, model: config.llmDriver };

  // Status terakhir tiap agen + milestone — dipakai snapshot saat (re)connect.
  const latestByAgent = new Map<string, AgentStatusPayload>();
  const latestMilestones: FirstSalePayload[] = [];

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

  io.on('connection', (socket) => {
    socket.emit('system:hello', {
      service: 'brain',
      version: '1.5',
      drivers: {
        llm: config.llmDriver,
        memory: config.memoryDriver,
        sandbox: config.sandboxDriver,
      },
      limits: {
        maxIterations: config.maxIterations,
        tokenBudget: config.tokenBudget,
        coverageThreshold: COVERAGE_THRESHOLD,
      },
      loopControls: { endpoint: 'control:halt | control:resume', state: control.snapshot() },
      socketPath: config.socketPath,
      history: bus.history.slice(-50),
    });

    // Snapshot on-demand: klien (re)connect menarik state terakhir sekali —
    // dipakai Theater untuk memulihkan viewport tanpa menunggu event berikutnya.
    socket.on('state:request', (ack?: (r: unknown) => void) => {
      const snapshot = {
        agents: [...latestByAgent.values()],
        milestones: latestMilestones.slice(-1),
        control: control.snapshot(),
        generatedAt: new Date().toISOString(),
      };
      socket.emit('state:snapshot', snapshot);
      ack?.({ ok: true, snapshot });
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
      ack?.({ ok: true, control: control.snapshot() });
    });

    socket.on('founder:directive', async (prompt: unknown, ack?: (r: unknown) => void) => {
      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        ack?.({ ok: false, error: 'empty directive' });
        return;
      }
      ack?.({ ok: true, queued: true });
      const { runAutonomous } = await import('../run');
      void runAutonomous(prompt, { config, emit: bus, control }).catch((err: unknown) => {
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
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
