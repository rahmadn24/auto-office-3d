import { readFileSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { createServer } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';

import { Server, type Socket } from 'socket.io';

import type { BaseCheckpointSaver } from '@langchain/langgraph';

import type { BriefingService } from '../briefing';
import type { Config } from '../config';
import { createControl, type RunControl } from '../control';
import { CsService, EmailChannelAdapter, WhatsAppAdapter, WidgetAdapter } from '../cs';
import type { LeadsStore } from '../cs';
import { contractsDir, dirSizeBytes } from '../durability/paths';
import type { RunStore } from '../durability/store';
import { EventBus } from '../events';
import type { EmailDriver } from '../integrations/types';
import { breakerMessage, runFailedMessage, type NotifyDriver } from '../integrations/notify';
import type { LLMProvider } from '../llm/provider';
import { logger } from '../logger';
import { createPayment, type PaymentProvider } from '../payments';
import { COVERAGE_THRESHOLD } from '../sandbox/types';
import { assertDailyBudget, readDailyBudget } from '../telemetry/dailyBudget';
import { AGENT_HOME_ZONE, AGENT_IDS } from '../types';
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
import { isAuthorizedHandshake } from './auth';
import { createHttpHandler } from './http';
import {
  parseAgentStatus,
  parseArtifacts,
  parseBrief,
  parseBudgetUpdate,
  parseChatTurn,
  parseDeployUpdate,
  parseFirstSale,
  parseLeadUpdate,
  parseMemoryRetrieval,
  parseRevenueUpdate,
  parseSocialPost,
} from './contract';
import type { BudgetUpdatePayload, ReplayEventPayload, ReplayFramePayload } from './contract';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BrainServer {
  io: Server;
  httpServer: HttpServer | HttpsServer;
  port: number;
  url: string;
  control: RunControl;
  /** CS Agent service (Fase 11) — aktif bila leads/llm/memory/email tersedia. */
  cs?: CsService;
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
  /** Leads store bersama (Fase 11) — handoff Marketer → CS Inbox. */
  leads?: LeadsStore;
  /** LLM provider untuk balasan CS (task `cs`). */
  llm?: LLMProvider;
  /** Driver email — channel inbound/outbound CS (Fase 11). */
  email?: EmailDriver;
  /** Notifikasi founder (Fase 12) — run gagal / circuit breaker dari jalur socket. */
  notify?: NotifyDriver;
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

  /**
   * Daemon restart mengosongkan `latestByAgent`. Tanpa backfill, dashboard baru
   * tampil kosong (AGENTS 0 / TOKENS 0) walau run terakhir sudah selesai.
   * Rekonstruksi status idle dari run store; stage final tetap diambil dari
   * `runs` di snapshot sehingga COMPLETED/FAILED tidak salah tampil.
   */
  function restoreLatestAgents(): void {
    if (latestByAgent.size > 0 || !store) return;
    const latest = store.listRuns(1)[0];
    if (!latest) return;
    const message =
      latest.status === 'completed'
        ? 'RUN COMPLETE · semua agen idle'
        : latest.status === 'failed'
          ? 'RUN FAILED · cek riwayat di Pipeline'
          : latest.status === 'halted'
            ? 'RUN HALTED · checkpoint tersimpan'
            : latest.status === 'interrupted'
              ? 'RUN INTERRUPTED · resume di Pipeline'
              : 'RUN RUNNING · status dipulihkan';
    for (const agentId of AGENT_IDS) {
      latestByAgent.set(
        agentId,
        EventBus.payload({
          runId: latest.runId,
          agentId,
          action: 'idle',
          zone: AGENT_HOME_ZONE[agentId],
          logMessage: message,
          telemetry: { tokensUsed: latest.tokensUsed, latencyMs: 0, model: 'restored' },
        }),
      );
    }
  }

  restoreLatestAgents();

  /** Tab Artifacts juga harus terisi setelah daemon restart (Fase 13-polish). */
  function restoreLatestArtifacts(): void {
    if (latestArtifacts || !store) return;
    const stored = store.latestArtifacts();
    if (!stored) return;
    const parsed = parseArtifacts(stored);
    if (parsed.ok) latestArtifacts = parsed.payload;
    else logger.warn({ issues: parsed.issues }, 'artifact durable tidak valid — dilewati');
  }

  restoreLatestArtifacts();

  // CS Agent (Fase 11) — dibangun sebelum HTTP handler (webhook & kontrak ikut
  // memakainya); broadcast memakai ioRef karena io baru dibuat setelah handler.
  let ioRef: Server | null = null;
  const cs =
    opts.leads && opts.llm && opts.email && memory
      ? new CsService({
          store: opts.leads,
          memory,
          llm: opts.llm,
          payment,
          email: opts.email,
          adapters: {
            widget: new WidgetAdapter(),
            whatsapp: new WhatsAppAdapter({
              driver: config.whatsappDriver,
              ...(config.whatsappAccessToken ? { accessToken: config.whatsappAccessToken } : {}),
              ...(config.whatsappPhoneNumberId
                ? { phoneNumberId: config.whatsappPhoneNumberId }
                : {}),
              ...(config.whatsappVerifyToken ? { verifyToken: config.whatsappVerifyToken } : {}),
              templateName: config.whatsappTemplateName,
            }),
            email: new EmailChannelAdapter({
              email: opts.email,
              ...(config.emailInboundSecret ? { inboundSecret: config.emailInboundSecret } : {}),
            }),
          },
          broadcast: (event, payload) => ioRef?.emit(event, payload),
          contractsDir: contractsDir(config.dataDir),
          publicBaseUrl: config.csPublicBaseUrl,
          followupDelayMs: config.csFollowupDelayMs,
          maxFollowups: config.csMaxFollowups,
        })
      : undefined;

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
    ...(cs ? { cs } : {}),
    ...(cs ? { widget: { baseUrl: config.csWidgetUrl, socketPath: config.socketPath } } : {}),
    ...(config.authToken ? { authToken: config.authToken } : {}),
    maxBodyBytes: config.webhookMaxBodyBytes,
    corsOrigins: config.corsOrigins,
    // /health diperkaya (Fase 12): driver aktif + jumlah run + ukuran DATA_DIR.
    health: () => {
      const latest = store?.listRuns(1)[0];
      return {
        drivers: {
          llm: config.llmDriver,
          memory: config.memoryDriver,
          sandbox: config.sandboxDriver,
          deploy: config.deployDriver,
          payment: payment.id,
          email: config.emailDriver,
          social: config.socialDriver,
          whatsapp: config.whatsappDriver,
          notify: opts.notify?.id ?? 'stub',
        },
        ...(store
          ? {
              runs: {
                total: store.countRuns(),
                latest: latest
                  ? { runId: latest.runId, status: latest.status, updatedAt: latest.updatedAt }
                  : null,
              },
            }
          : {}),
        data: { dir: config.dataDir, bytes: dirSizeBytes(config.dataDir) },
        budget: budgetPayload(),
      };
    },
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
    // Fase 13: allowlist origin via CORS_ORIGINS (`*` = semua — default lokal).
    cors: { origin: config.corsOrigins.includes('*') ? true : config.corsOrigins },
    // WebSocket dulu; bila gagal (jaringan memblokir) otomatis jatuh ke long-polling.
    transports: ['websocket', 'polling'],
    pingInterval: 10_000,
    pingTimeout: 5_000,
  });
  ioRef = io;

  /** Status budget harian + timestamp — dipakai /health, system:hello, budget:update. */
  function budgetPayload(): BudgetUpdatePayload {
    return {
      ...readDailyBudget(store, config.dailyTokenBudget),
      timestamp: new Date().toISOString(),
    };
  }

  /** Broadcast status budget terbaru ke Theater (setelah run selesai / ditolak). */
  function emitBudget(): void {
    const parsed = parseBudgetUpdate(budgetPayload());
    if (!parsed.ok) {
      logger.warn({ issues: parsed.issues }, 'budget:update DITOLAK (skema tidak valid)');
      return;
    }
    io.emit('budget:update', parsed.payload);
  }

  // Auth token (Fase 12): koneksi tanpa token tetap diterima sebagai kanal
  // publik widget CS (`cs:widget_message`); aksi operator butuh token.
  // Caddy VPS menyuntik `Authorization: Bearer <BRAIN_AUTH_TOKEN>` di host office.
  io.use((socket, next) => {
    socket.data.privileged = isAuthorizedHandshake(socket.handshake, config.authToken);
    next();
  });

  /** true = ditolak (ack error sudah dikirim ke klien). */
  function denyUnprivileged(socket: Socket, ack?: (r: unknown) => void): boolean {
    if (!config.authToken || socket.data.privileged === true) return false;
    ack?.({ ok: false, error: 'unauthorized: token required' });
    return true;
  }

  const offAgent = bus.onAgent((payload) => {
    const parsed = parseAgentStatus(payload);
    if (!parsed.ok) {
      logger.warn({ issues: parsed.issues }, 'agent:status_update DITOLAK (skema tidak valid)');
      return;
    }
    latestByAgent.set(parsed.payload.agentId, parsed.payload);
    io.emit('agent:status_update', parsed.payload);
  });
  const offMilestone = bus.onMilestone((payload) => {
    const parsed = parseFirstSale(payload);
    if (!parsed.ok) {
      logger.warn({ issues: parsed.issues }, 'milestone:first_sale DITOLAK (skema tidak valid)');
      return;
    }
    latestMilestones.push(parsed.payload);
    io.emit('milestone:first_sale', parsed.payload);
  });
  const offDeploy = bus.onDeploy((payload) => {
    const parsed = parseDeployUpdate(payload);
    if (!parsed.ok) {
      logger.warn({ issues: parsed.issues }, 'deploy:update DITOLAK (skema tidak valid)');
      return;
    }
    latestDeploy = parsed.payload;
    io.emit('deploy:update', parsed.payload);
  });
  const offRevenue = bus.onRevenue((payload) => {
    const parsed = parseRevenueUpdate(payload);
    if (!parsed.ok) {
      logger.warn({ issues: parsed.issues }, 'revenue:update DITOLAK (skema tidak valid)');
      return;
    }
    latestRevenue = parsed.payload;
    io.emit('revenue:update', parsed.payload);
  });
  const offSocial = bus.onSocial((payload) => {
    const parsed = parseSocialPost(payload);
    if (!parsed.ok) {
      logger.warn({ issues: parsed.issues }, 'social:post DITOLAK (skema tidak valid)');
      return;
    }
    latestSocial.push(parsed.payload);
    io.emit('social:post', parsed.payload);
  });
  const offRetrieval = bus.onRetrieval((payload) => {
    const parsed = parseMemoryRetrieval(payload);
    if (!parsed.ok) {
      logger.warn({ issues: parsed.issues }, 'memory:retrieval DITOLAK (skema tidak valid)');
      return;
    }
    latestRetrievals.push(parsed.payload);
    io.emit('memory:retrieval', parsed.payload);
  });
  const offArtifacts = bus.onArtifacts((payload) => {
    const parsed = parseArtifacts(payload);
    if (!parsed.ok) {
      logger.warn({ issues: parsed.issues }, 'artifacts:ready DITOLAK (skema tidak valid)');
      return;
    }
    latestArtifacts = parsed.payload;
    io.emit('artifacts:ready', parsed.payload);
  });
  const offLead = bus.onLead((payload) => {
    const parsed = parseLeadUpdate(payload);
    if (!parsed.ok) {
      logger.warn({ issues: parsed.issues }, 'lead:update DITOLAK (skema tidak valid)');
      return;
    }
    io.emit('lead:update', parsed.payload);
  });

  io.on('connection', (socket) => {
    /** Satu playback replay aktif per socket (kartu 10.4). */
    let replaySession: { cancelled: boolean } | null = null;
    socket.on('disconnect', () => {
      if (replaySession) replaySession.cancelled = true;
      replaySession = null;
    });

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
        whatsapp: config.whatsappDriver,
        cs: cs ? 'on' : 'off',
      },
      limits: {
        maxIterations: config.maxIterations,
        tokenBudget: config.tokenBudget,
        coverageThreshold: COVERAGE_THRESHOLD,
      },
      // Fase 13 — status budget harian lintas-run saat klien (re)connect.
      budget: budgetPayload(),
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
      if (denyUnprivileged(socket, ack)) return;
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
        leads: cs ? cs.inbox(20) : [],
        generatedAt: new Date().toISOString(),
      };
      socket.emit('state:snapshot', snapshot);
      ack?.({ ok: true, snapshot });
    });

    // SIMULATE PAYMENT (kartu 💳) — demo transaksi $29 tanpa akun gateway.
    // Driver aktif yang menentukan format event (stripe/midtrans/stub).
    socket.on('payment:simulate', (input: unknown, ack?: (r: unknown) => void) => {
      if (denyUnprivileged(socket, ack)) return;
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
      // Lead CS yang ditagih (bila simulasi membawa konteksnya) ikut jadi deal.
      if (cs && outcome.leadId && outcome.sale) {
        void cs
          .markDeal(outcome.leadId, {
            amount: outcome.sale.amount,
            currency: outcome.sale.currency,
            provider: outcome.provider,
          })
          .catch(() => undefined);
      }
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
      if (denyUnprivileged(socket, ack)) return;
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
      if (denyUnprivileged(socket, ack)) return;
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
      if (denyUnprivileged(socket, ack)) return;
      const limit = (input as { limit?: unknown } | undefined)?.limit;
      const runs = store?.listRuns(typeof limit === 'number' && limit > 0 ? limit : 20) ?? [];
      ack?.({ ok: true, runs });
    });

    // Resume run yang terputus (mis. daemon/VPS restart) dari checkpoint SQLite.
    socket.on('run:resume', async (input: unknown, ack?: (r: unknown) => void) => {
      if (denyUnprivileged(socket, ack)) return;
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
        ...(opts.leads ? { leads: opts.leads } : {}),
      })
        .then(({ state }) => {
          if (state.fallbackTriggered) {
            void opts.notify?.send(
              breakerMessage(state.runId, `safe-build aktif setelah ${state.maxIterations}x QA`),
            );
          }
        })
        .catch((err: unknown) => {
          logger.error({ err, runId }, 'resume run failed');
          void opts.notify?.send(runFailedMessage(runId, err));
        });
    });

    // EVENT REPLAY (kartu 10.4 — PRD §7): putar ulang run masa lalu dari event
    // log durable (`run_events`) ke klien peminta. Frame: start → event* → end.
    socket.on('run:replay', async (input: unknown, ack?: (r: unknown) => void) => {
      if (denyUnprivileged(socket, ack)) return;
      const rec = input as
        { runId?: unknown; stepMs?: unknown; limit?: unknown; cancel?: unknown } | null | undefined;

      // Batal: klien menghentikan playback yang sedang berjalan.
      if (rec?.cancel === true) {
        if (replaySession) replaySession.cancelled = true;
        ack?.({ ok: true, cancelled: true });
        return;
      }

      const runId = typeof rec?.runId === 'string' ? rec.runId.trim() : '';
      if (!store) {
        ack?.({ ok: false, error: 'run store unavailable' });
        return;
      }
      if (!runId) {
        ack?.({ ok: false, error: 'runId required' });
        return;
      }
      const run = store.getRun(runId);
      if (!run) {
        ack?.({ ok: false, error: `run ${runId} tidak ditemukan` });
        return;
      }

      const limit =
        typeof rec?.limit === 'number' && rec.limit > 0
          ? Math.min(Math.floor(rec.limit), 1000)
          : 500;
      const stepMs =
        typeof rec?.stepMs === 'number' ? Math.max(0, Math.min(rec.stepMs, 2000)) : 120;
      const events = store.listEvents(runId, limit);
      ack?.({ ok: true, runId, total: events.length, stepMs, run });

      // Satu playback per socket — request baru menggantikan yang lama.
      if (replaySession) replaySession.cancelled = true;
      const session = { cancelled: false };
      replaySession = session;

      const frame = (
        phase: 'start' | 'event' | 'end',
        index: number,
        event?: ReplayEventPayload,
      ): void => {
        const payload: ReplayFramePayload = {
          phase,
          runId,
          total: events.length,
          index,
          timestamp: new Date().toISOString(),
        };
        if (event) payload.event = event;
        socket.emit('run:replay', payload);
      };

      frame('start', 0);
      let index = 0;
      for (const record of events) {
        if (session.cancelled || !socket.connected) break;
        index += 1;
        frame('event', index, {
          seq: index,
          id: record.id,
          ts: record.ts,
          kind: record.kind,
          ...(record.agent ? { agent: record.agent } : {}),
          ...(record.message ? { message: record.message } : {}),
          ...(record.payload !== undefined ? { payload: record.payload } : {}),
        });
        if (stepMs > 0) await sleep(stepMs);
      }
      if (replaySession === session) replaySession = null;
      if (!session.cancelled && socket.connected) frame('end', index);
    });

    socket.on('founder:directive', async (prompt: unknown, ack?: (r: unknown) => void) => {
      if (denyUnprivileged(socket, ack)) return;
      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        ack?.({ ok: false, error: 'empty directive' });
        return;
      }
      // Fase 13 — budget harian lintas-run: tolak run baru dengan pesan jelas.
      try {
        assertDailyBudget(store, config.dailyTokenBudget);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, 'founder:directive DITOLAK — budget harian habis');
        ack?.({ ok: false, error: message });
        emitBudget();
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
        ...(opts.leads ? { leads: opts.leads } : {}),
      })
        .then(({ state }) => {
          if (state.fallbackTriggered) {
            void opts.notify?.send(
              breakerMessage(state.runId, `safe-build aktif setelah ${state.maxIterations}x QA`),
            );
          }
        })
        .catch((err: unknown) => {
          logger.error({ err }, 'autonomous run failed');
          void opts.notify?.send(runFailedMessage('founder:directive', err));
        })
        // Status budget berubah setelah run selesai (token tercatat) — segarkan UI.
        .finally(() => emitBudget());
    });

    /* ───────── Fase 8 — Briefing Room (PRD §3.1, §5.3) ───────── */

    // founder:chat { conversationId, message } → PM agent → pm:reply (broadcast).
    // Ack konsisten dengan founder:directive: langsung `queued`, balasan menyusul.
    socket.on('founder:chat', async (input: unknown, ack?: (r: unknown) => void) => {
      if (denyUnprivileged(socket, ack)) return;
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
          logger.warn({ issues: parsed.issues }, 'pm:reply DITOLAK (skema tidak valid)');
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
      if (denyUnprivileged(socket, ack)) return;
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
      if (denyUnprivileged(socket, ack)) return;
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

    /* ───────── Fase 11 — CS Agent: omnichannel inbox + closing (PRD §3.5) ───────── */

    // cs:list → ringkasan inbox (lead + pesan terakhir + jumlah pesan).
    socket.on('cs:list', (input: unknown, ack?: (r: unknown) => void) => {
      if (denyUnprivileged(socket, ack)) return;
      if (!cs) {
        ack?.({ ok: false, error: 'cs agent unavailable' });
        return;
      }
      const limit = (input as { limit?: unknown } | undefined)?.limit;
      ack?.({
        ok: true,
        entries: cs.inbox(
          typeof limit === 'number' && limit > 0 ? Math.min(Math.floor(limit), 200) : 50,
        ),
      });
    });

    // cs:history → transkrip satu percakapan (dipakai CS Inbox saat membuka thread).
    socket.on('cs:history', (input: unknown, ack?: (r: unknown) => void) => {
      if (denyUnprivileged(socket, ack)) return;
      const conversationId = (input as { conversationId?: unknown } | undefined)?.conversationId;
      if (!cs) {
        ack?.({ ok: false, error: 'cs agent unavailable' });
        return;
      }
      if (typeof conversationId !== 'string' || conversationId.trim().length === 0) {
        ack?.({ ok: false, error: 'conversationId required' });
        return;
      }
      ack?.({ ok: true, conversationId, turns: cs.history(conversationId.trim()) });
    });

    // cs:widget_message → visitor halaman demo mengirim pesan (channel widget).
    socket.on('cs:widget_message', async (input: unknown, ack?: (r: unknown) => void) => {
      if (!cs) {
        ack?.({ ok: false, error: 'cs agent unavailable' });
        return;
      }
      const rec = input as { visitorId?: unknown; name?: unknown; message?: unknown } | null;
      const visitorId = typeof rec?.visitorId === 'string' ? rec.visitorId.trim() : '';
      const message = typeof rec?.message === 'string' ? rec.message.trim() : '';
      if (!visitorId || !message) {
        ack?.({ ok: false, error: 'visitorId & message required' });
        return;
      }
      ack?.({ ok: true, queued: true });
      try {
        await cs.handleWidgetMessage({
          visitorId,
          message,
          ...(typeof rec?.name === 'string' && rec.name.trim() ? { name: rec.name.trim() } : {}),
        });
      } catch (err) {
        // Widget jangan tertinggal menunggu — kirim turn error eksplisit.
        const fallback: ChatTurnPayload = {
          conversationId: `cs:widget:${visitorId.toLowerCase()}`,
          channel: 'cs_widget',
          role: 'agent',
          agentId: 'cs_agent',
          message: `⚠️ gagal memproses pesan: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date().toISOString(),
        };
        io.emit('cs:message', fallback);
      }
    });

    // cs:quote → aksi cepat CS Inbox: quote → payment link + kontrak PDF.
    socket.on('cs:quote', async (input: unknown, ack?: (r: unknown) => void) => {
      if (denyUnprivileged(socket, ack)) return;
      if (!cs) {
        ack?.({ ok: false, error: 'cs agent unavailable' });
        return;
      }
      const rec = input as
        | { leadId?: unknown; amount?: unknown; currency?: unknown; productName?: unknown }
        | null
        | undefined;
      const leadId = typeof rec?.leadId === 'string' ? rec.leadId.trim() : '';
      if (!leadId) {
        ack?.({ ok: false, error: 'leadId required' });
        return;
      }
      const quoteInput: { amount?: number; currency?: 'USD' | 'IDR'; productName?: string } = {};
      if (typeof rec?.amount === 'number' && rec.amount > 0) quoteInput.amount = rec.amount;
      if (rec?.currency === 'USD' || rec?.currency === 'IDR') quoteInput.currency = rec.currency;
      if (typeof rec?.productName === 'string' && rec.productName.trim()) {
        quoteInput.productName = rec.productName.trim();
      }
      const result = await cs.quote(leadId, quoteInput);
      if (!result.ok) {
        ack?.({ ok: false, error: result.error });
        return;
      }
      ack?.({ ok: true, lead: result.lead, link: result.link, contractUrl: result.contractUrl });
    });

    // cs:sweep → jalankan follow-up engine sekarang (demo/e2e; scheduler tetap jalan).
    socket.on('cs:sweep', async (input: unknown, ack?: (r: unknown) => void) => {
      if (denyUnprivileged(socket, ack)) return;
      if (!cs) {
        ack?.({ ok: false, error: 'cs agent unavailable' });
        return;
      }
      // Default force=true (tombol demo); kirim {force:false} untuk hanya yang jatuh tempo.
      const force = (input as { force?: unknown } | undefined)?.force !== false;
      const result = await cs.sweep({ force });
      ack?.({ ok: true, ...result });
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
    ...(cs ? { cs } : {}),
    url: `${useTls ? 'wss' : 'ws'}://localhost:${port}${config.socketPath}`,
    async close() {
      offAgent();
      offMilestone();
      offDeploy();
      offRevenue();
      offSocial();
      offRetrieval();
      offArtifacts();
      offLead();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
