import { create } from 'zustand';

import type {
  AgentStatusPayload,
  AgentId,
  ArtifactsPayload,
  BudgetUpdatePayload,
  DeployUpdatePayload,
  FirstSalePayload,
  MemoryRetrievalPayload,
  RevenueUpdatePayload,
  SocialPostPayload,
} from '@/lib/events';
import type { ZoneKey } from '@/lib/zones';
// Import runtime wajib relatif: vitest theater tidak me-resolve alias '@/*'
// (import type '@/...' aman karena dihapus saat transform).
import { formatMoney } from '../lib/format';

/** Koneksi ke Brain (Socket.io) — PRD §2.1. */
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

/** Baris feed mentah untuk Agent Stream right-rail. */
export interface FeedItem {
  id: string;
  agentId: AgentId;
  division: string;
  action: string;
  targetZone: TargetZoneAlias;
  detail: string;
  /** Epoch ms — dipakai timestamp milidetik & event/sec. */
  at: number;
  /** Teks timestamp HH:MM:SS.mmm dari brain. */
  tsLabel: string;
  tokens?: number;
  latencyMs?: number;
  runId: string;
  kind: 'status' | 'milestone' | 'system';
}

type TargetZoneAlias = AgentStatusPayload['targetZone'];

const MAX_FEED = 200;
const MAX_DIRECTIVES = 8;
const STALE_MS = 5_000;

let feedSeq = 0;
const nextFeedId = (): string => `f${(feedSeq += 1)}`;
let directiveSeq = 0;
const nextDirectiveId = (): string => `d${(directiveSeq += 1)}`;

/** Jam lokal HH:MM:SS.mmm — format sama dengan timestamp brain. */
export function clockLabel(at: number): string {
  const d = new Date(at);
  const p = (n: number, len = 2): string => String(n).padStart(len, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Satu baris riwayat Founder Prompt (PRD §3.1: satu-satunya input manusia). */
export interface DirectiveRecord {
  id: string;
  prompt: string;
  at: number;
  tsLabel: string;
  /** 'queued' = ack brain diterima; 'failed' = nack / offline / timeout. */
  status: 'queued' | 'failed';
  error?: string;
}

/**
 * Parse `timestamp` brain (HH:MM:SS.mmm, jam lokal) ke epoch ms hari ini.
 * Dipakai untuk latensi emit→render (PRD Milestone #4: < 50ms) & urutan feed.
 */
export function parseBrainTimestamp(ts: string): number {
  const m = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(ts);
  if (!m) return Date.now();
  const now = new Date();
  const [, hh, mm, ss, ms] = m;
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Number(hh),
    Number(mm),
    Number(ss),
    Number(ms),
  ).getTime();
}

/**
 * Epoch ms dengan koreksi rollover tengah malam: timestamp yang tampak >12 jam
 * lebih tua dari status sebelumnya dianggap milik hari berikutnya, bukan event basi.
 */
export function parseBrainTimestampWithRollover(ts: string, prevMs: number | null): number {
  let ms = parseBrainTimestamp(ts);
  if (prevMs !== null && ms < prevMs - 12 * 60 * 60 * 1000) ms += 24 * 60 * 60 * 1000;
  return ms;
}

/**
 * Matriks aksi → state animasi 3D (theater/store/officeStore AnimState).
 * PRD §4.2: walking/celebrating dipetakan langsung; sisa aksi kerja = WORKING.
 */
export function actionToAnimState(
  action: AgentStatusPayload['currentAction'],
): 'IDLE' | 'WORKING' | 'WALKING' | 'CELEBRATE' {
  switch (action) {
    case 'idle':
      return 'IDLE';
    case 'walking':
      return 'WALKING';
    case 'celebrating':
      return 'CELEBRATE';
    default:
      return 'WORKING';
  }
}

/** Aksi aktif per zona → teks suffix label (contoh: "ACTIVE DEBATE"). */
const ZONE_ACTIVITY: Partial<Record<AgentStatusPayload['currentAction'], string>> = {
  discussing: 'ACTIVE DEBATE',
  coding: 'BUILDING',
  testing: 'TESTING',
  deploying: 'DEPLOYING',
  marketing: 'LAUNCHING',
  celebrating: 'CELEBRATE',
};

interface BrainStore {
  connection: ConnectionStatus;
  /** Latensi ping Socket.io (ms), null bila belum ada. */
  pingMs: number | null;
  /** Emit → render terakhir (ms), diukur dari timestamp brain. */
  latencyMs: number | null;
  /** Emit → render terbaik sepanjang sesi (ms). */
  bestLatencyMs: number | null;
  brainVersion: string | null;
  /** Status terakhir tiap agen — diff update, bukan replace penuh. */
  agents: Partial<Record<AgentId, AgentStatusPayload>>;
  /** Epoch ms status terakhir per agen — dipakai diff & koreksi rollover tengah malam. */
  agentStatusMs: Partial<Record<AgentId, number>>;
  /** Stage run aktif, diturunkan dari aksi mayoritas (mis. BUILDING). */
  runStage: string | null;
  runId: string | null;
  /** Token terakumulasi (max telemetry yang pernah terlihat). */
  tokens: number;
  feed: FeedItem[];
  hasCustomers: boolean;
  milestone: FirstSalePayload | null;
  /** paymentEventId yang sudah diproses — idempoten (PRD §5.2). */
  seenSaleIds: Set<string>;
  /** Epoch ms event terakhir — untuk deteksi stale & events/sec. */
  lastEventAt: number | null;
  /** Jumlah event status diterima sepanjang sesi. */
  eventCount: number;
  /** Status pipeline deployment terakhir (PRD §3.3). */
  deploy: DeployUpdatePayload | null;
  /** Metrik Stripe Webhook Sentinel terakhir (PRD §3.4). */
  revenue: RevenueUpdatePayload | null;
  /** Post kampanye sosial terakhir (urut terima, maks 8). */
  social: SocialPostPayload[];
  /** Stream ingatan semantik terakhir (Vector DB inspector, maks 30). */
  retrievals: MemoryRetrievalPayload[];
  /** Jumlah vektor per namespace memori (dari brain). */
  memorySizes: Record<string, number>;
  /** State loop kontrol graph (halt/resume) dari brain. */
  control: { haltedAll: boolean; runIds: string[] } | null;
  /** Bundel hasil run terakhir (PRD + berkas + QA) untuk viewer Artifacts. */
  artifacts: ArtifactsPayload | null;
  /** Budget token harian lintas-run (Fase 13) — dari system:hello & budget:update. */
  budget: BudgetUpdatePayload | null;
  /** Riwayat Founder Prompt yang dikirim dari UI (terbaru di depan, maks 8). */
  directives: DirectiveRecord[];

  setConnection(status: ConnectionStatus): void;
  setPing(ms: number): void;
  setBrainVersion(v: string): void;
  /** Perbarui status budget harian (Fase 13). */
  setBudget(budget: BudgetUpdatePayload): void;
  /** Terapkan payload status: validasi, diff update agent, dorong feed. */
  applyStatus(payload: AgentStatusPayload): boolean;
  /** Terapkan milestone first sale — idempoten per paymentEventId. */
  applyMilestone(payload: FirstSalePayload): boolean;
  /** Terapkan update pipeline deployment (GitHub → Vercel → Health). */
  applyDeploy(payload: DeployUpdatePayload): void;
  /** Terapkan metrik revenue dari Stripe sentinel. */
  applyRevenue(payload: RevenueUpdatePayload): void;
  /** Terapkan hasil dispatch kampanye sosial. */
  applySocial(payload: SocialPostPayload): void;
  /** Terapkan satu hasil pencarian memori (stream Vector DB). */
  applyRetrieval(payload: MemoryRetrievalPayload): void;
  /** Perbarui jumlah vektor per namespace. */
  applyMemory(sizes: Record<string, number>): void;
  /** Perbarui state loop kontrol (haltedAll). */
  applyControl(c: { haltedAll: boolean; runIds: string[] }): void;
  /** Terapkan bundel artifacts:ready (viewer Artifacts & PRD). */
  applyArtifacts(payload: ArtifactsPayload): void;
  /** Catat satu Founder Prompt di riwayat + feed (kind: system). */
  pushDirective(prompt: string, status: 'queued' | 'failed', error?: string): void;
  /** Hapus semua baris feed (tombol CLEAR FEED). */
  clearFeed(): void;
  /** Kosongkan stream retrieval (tombol FlushState). */
  clearRetrievals(): void;
  /** Ambil ulang snapshot setelah reconnect. */
  hydrateSnapshot(snapshot: {
    agents?: AgentStatusPayload[];
    milestones?: FirstSalePayload[];
    deploy?: DeployUpdatePayload | null;
    revenue?: RevenueUpdatePayload | null;
    social?: SocialPostPayload[];
    retrieval?: MemoryRetrievalPayload[];
    memory?: Record<string, number>;
    control?: { haltedAll: boolean; runIds: string[] };
    artifacts?: ArtifactsPayload | null;
    /** Run terakhir dari run store — sumber stage final setelah run selesai. */
    latestRun?: { runId: string; status: string; stage: string } | null;
  }): void;
}

/** Urutan stage untuk memilih aksi paling maju. */
const STAGE_ORDER = [
  'idle',
  'discussing',
  'coding',
  'testing',
  'deploying',
  'marketing',
  'celebrating',
] as const;

function deriveRunStage(agents: Partial<Record<AgentId, AgentStatusPayload>>): string | null {
  let best = -1;
  let count = 0;
  let allIdle = true;
  const order = STAGE_ORDER as readonly string[];
  for (const a of Object.values(agents)) {
    if (!a) continue;
    count += 1;
    if (a.currentAction !== 'idle') allIdle = false;
    // 'walking' tidak ada di STAGE_ORDER → indexOf -1 (diabaikan).
    const idx = order.indexOf(a.currentAction);
    if (idx > best) best = idx;
  }
  // Semua agen sudah dipulangkan oleh event penutup run → stage selesai.
  // Tanpa ini dashboard menyimpan aksi terakhir (mis. MARKETING) selamanya.
  if (count > 1 && allIdle) return 'DONE';
  const stage = best >= 0 ? order[best] : undefined;
  return stage ? stage.toUpperCase() : null;
}

export const useBrain = create<BrainStore>((set, get) => ({
  connection: 'offline',
  pingMs: null,
  latencyMs: null,
  bestLatencyMs: null,
  brainVersion: null,
  agents: {},
  agentStatusMs: {},
  runStage: null,
  runId: null,
  tokens: 0,
  feed: [],
  hasCustomers: false,
  milestone: null,
  seenSaleIds: new Set<string>(),
  lastEventAt: null,
  eventCount: 0,
  deploy: null,
  revenue: null,
  social: [],
  retrievals: [],
  memorySizes: {},
  control: null,
  artifacts: null,
  budget: null,
  directives: [],

  setConnection: (connection) => set({ connection }),
  setPing: (pingMs) => set({ pingMs }),
  setBrainVersion: (brainVersion) => set({ brainVersion }),
  setBudget: (budget) => set({ budget }),

  applyStatus: (payload) => {
    const s = get();
    const now = Date.now();

    // Diff update: bandingkan epoch ms (tahan rollover tengah malam).
    const prev = s.agents[payload.agentId];
    const prevMs = s.agentStatusMs[payload.agentId] ?? null;
    const at = parseBrainTimestampWithRollover(payload.timestamp, prevMs);
    if (prev && prevMs !== null && at <= prevMs) return false;
    const latency = now - at;
    const item: FeedItem = {
      id: nextFeedId(),
      agentId: payload.agentId,
      division: payload.division,
      action: payload.currentAction,
      targetZone: payload.targetZone,
      detail: payload.logMessage,
      at: now,
      tsLabel: payload.timestamp,
      tokens: payload.telemetry?.tokensUsed,
      latencyMs: payload.telemetry?.latencyMs,
      runId: payload.runId,
      kind: 'status',
    };
    const feed = [item, ...s.feed].slice(0, MAX_FEED);
    const agents = { ...s.agents, [payload.agentId]: payload };
    const best = s.bestLatencyMs === null ? latency : Math.min(s.bestLatencyMs, latency);
    // Token header = progres run aktif, bukan maksimum sepanjang sesi browser.
    // Run baru otomatis mereset angka; run yang sama memakai nilai tertinggi.
    const tokens =
      s.runId && s.runId !== payload.runId
        ? (payload.telemetry?.tokensUsed ?? 0)
        : Math.max(s.tokens, payload.telemetry?.tokensUsed ?? 0);

    set({
      agents,
      agentStatusMs: { ...s.agentStatusMs, [payload.agentId]: at },
      feed,
      runStage: deriveRunStage(agents),
      runId: payload.runId,
      tokens,
      latencyMs: latency,
      bestLatencyMs: best,
      lastEventAt: now,
      eventCount: s.eventCount + 1,
    });
    return true;
  },

  applyMilestone: (payload) => {
    const s = get();
    if (s.seenSaleIds.has(payload.paymentEventId)) return false;
    const seen = new Set(s.seenSaleIds);
    seen.add(payload.paymentEventId);
    const at = parseBrainTimestamp(payload.timestamp);
    const item: FeedItem = {
      id: nextFeedId(),
      agentId: 'marketing_agent',
      division: 'Growth',
      action: 'milestone:first_sale',
      targetZone: 'central_bus',
      detail: `${payload.customer.city}, ${payload.customer.country} · ${formatMoney(payload.amount, payload.currency)} · ${payload.paymentProvider} · ${payload.customer.maskedEmail}`,
      at: Date.now(),
      tsLabel: payload.timestamp,
      runId: payload.runId,
      kind: 'milestone',
    };
    set({
      hasCustomers: true,
      milestone: payload,
      seenSaleIds: seen,
      runStage: 'DONE',
      feed: [item, ...s.feed].slice(0, MAX_FEED),
      lastEventAt: Date.now(),
      eventCount: s.eventCount + 1,
      latencyMs: Date.now() - at,
    });
    return true;
  },

  clearFeed: () => set({ feed: [] }),

  clearRetrievals: () => set({ retrievals: [] }),

  applyRetrieval: (payload) => {
    const s = get();
    set({ retrievals: [...s.retrievals, payload].slice(-30) });
  },

  applyMemory: (sizes) => set({ memorySizes: sizes }),

  applyControl: (c) => set({ control: c }),

  applyArtifacts: (payload) => set({ artifacts: payload }),

  pushDirective: (prompt, status, error) => {
    const at = Date.now();
    const rec: DirectiveRecord = {
      id: nextDirectiveId(),
      prompt,
      at,
      tsLabel: clockLabel(at),
      status,
      error,
    };
    const s = get();
    // Riwayat di Agent Stream (kind: system) — operator melihat prompt-nya
    // beserta hasil ack (queued/failed) sebagai satu baris feed.
    const item: FeedItem = {
      id: nextFeedId(),
      agentId: 'founder_agent',
      division: 'Founder',
      action: 'founder:directive',
      targetZone: 'founder_desk',
      detail: status === 'queued' ? prompt : `${prompt} · ${error ?? 'failed'}`,
      at,
      tsLabel: rec.tsLabel,
      runId: s.runId ?? '—',
      kind: 'system',
    };
    set({
      directives: [rec, ...s.directives].slice(0, MAX_DIRECTIVES),
      feed: [item, ...s.feed].slice(0, MAX_FEED),
      lastEventAt: at,
    });
  },

  applyDeploy: (payload) => {
    const s = get();
    const item: FeedItem = {
      id: nextFeedId(),
      agentId: 'devops_agent',
      division: 'DevOps',
      action: `deploy:${payload.status}`,
      targetZone: 'devops_hub',
      detail:
        payload.status === 'ready'
          ? `repo ${payload.repoName} → https://${payload.liveUrl}`
          : payload.status === 'degraded'
            ? `DEGRADED · ${payload.degradedReason ?? 'unknown'}`
            : `${payload.repoName} · ${payload.buildSteps.filter((b) => b.status === 'done').length}/${payload.buildSteps.length} steps`,
      at: Date.now(),
      tsLabel: payload.timestamp,
      runId: payload.runId,
      kind: 'status',
    };
    set({
      deploy: payload,
      feed: [item, ...s.feed].slice(0, MAX_FEED),
      lastEventAt: Date.now(),
      eventCount: s.eventCount + 1,
    });
  },

  applyRevenue: (payload) => {
    const s = get();
    set({ revenue: { ...payload, runId: payload.runId || s.runId || 'webhook' } });
  },

  applySocial: (payload) => {
    const s = get();
    const item: FeedItem = {
      id: nextFeedId(),
      agentId: 'marketing_agent',
      division: 'Growth',
      action: `social:${payload.platform}`,
      targetZone: 'marketing_studio',
      detail: `${payload.status} · ${payload.queueId} · ${payload.metrics.impressions} impr · "${payload.hook.slice(0, 60)}"`,
      at: Date.now(),
      tsLabel: payload.timestamp,
      runId: payload.runId,
      kind: 'status',
    };
    set({
      social: [...s.social, payload].slice(-8),
      feed: [item, ...s.feed].slice(0, MAX_FEED),
      lastEventAt: Date.now(),
      eventCount: s.eventCount + 1,
    });
  },

  hydrateSnapshot: ({
    agents,
    milestones,
    deploy,
    revenue,
    social,
    retrieval,
    memory,
    control,
    artifacts,
    latestRun,
  }) => {
    const s = get();
    const map: Partial<Record<AgentId, AgentStatusPayload>> = { ...s.agents };
    const statusMs = { ...s.agentStatusMs };
    const snapshotFeed: FeedItem[] = [];
    let snapshotRunId: string | null = null;
    let newestSnapshotAt = -Infinity;
    for (const a of agents ?? []) {
      const prevMs = statusMs[a.agentId] ?? null;
      const at = parseBrainTimestampWithRollover(a.timestamp, prevMs);
      if (prevMs === null || at > prevMs) {
        map[a.agentId] = a;
        statusMs[a.agentId] = at;
        if (at > newestSnapshotAt) {
          newestSnapshotAt = at;
          snapshotRunId = a.runId;
        }
        // Fresh load / reconnect tanpa feed: tampilkan status terakhir sebagai
        // konteks, bukan hanya milestone terakhir. Saat reconnect dengan feed
        // yang sudah hidup, jangan duplikasi event ke stream.
        if (s.feed.length === 0) {
          snapshotFeed.push({
            id: nextFeedId(),
            agentId: a.agentId,
            division: a.division,
            action: a.currentAction,
            targetZone: a.targetZone,
            detail: a.logMessage,
            at,
            tsLabel: a.timestamp,
            tokens: a.telemetry?.tokensUsed,
            latencyMs: a.telemetry?.latencyMs,
            runId: a.runId,
            kind: 'status',
          });
        }
      }
    }
    let hasCustomers = s.hasCustomers;
    let milestone = s.milestone;
    const seen = new Set(s.seenSaleIds);
    const feed = [...s.feed];
    for (const m of milestones ?? []) {
      if (seen.has(m.paymentEventId)) continue;
      seen.add(m.paymentEventId);
      hasCustomers = true;
      milestone = m;
      feed.push({
        id: nextFeedId(),
        agentId: 'marketing_agent',
        division: 'Growth',
        action: 'milestone:first_sale',
        targetZone: 'central_bus',
        detail: `${m.customer.city} · ${formatMoney(m.amount, m.currency)} · ${m.paymentProvider}`,
        at: Date.now(),
        tsLabel: m.timestamp,
        runId: m.runId,
        kind: 'milestone',
      });
    }
    // Snapshot terbaru = milestone di atas, lalu status agen (terbaru dulu).
    snapshotFeed.sort((a, b) => b.at - a.at);
    feed.push(...snapshotFeed);
    // Telemetry token untuk run yang di-snapshot — reset bila run berganti.
    const snapshotTokens = (agents ?? []).reduce(
      (m, a) => Math.max(m, a.telemetry?.tokensUsed ?? 0),
      0,
    );
    const tokens =
      snapshotRunId && s.runId && snapshotRunId !== s.runId
        ? snapshotTokens
        : Math.max(s.tokens, snapshotTokens);
    // Run store adalah sumber kebenaran untuk stage final. Status agen terakhir
    // bisa saja masih aksi lama saat run sudah COMPLETED (mis. setelah restart).
    const latestRunApplies =
      latestRun !== null &&
      latestRun !== undefined &&
      (s.runId === null || s.runId === latestRun.runId) &&
      (snapshotRunId === null || snapshotRunId === latestRun.runId);
    const runStage =
      latestRunApplies && latestRun.status !== 'running'
        ? latestRun.status === 'completed'
          ? 'DONE'
          : latestRun.status.toUpperCase()
        : deriveRunStage(map);
    set({
      agents: map,
      agentStatusMs: statusMs,
      hasCustomers,
      milestone,
      seenSaleIds: seen,
      runStage,
      runId: s.runId ?? snapshotRunId ?? latestRun?.runId ?? null,
      feed: feed.slice(0, MAX_FEED),
      eventCount: Math.max(s.eventCount, feed.length),
      tokens,
      deploy: deploy ?? s.deploy,
      revenue: revenue ?? s.revenue,
      social: social && social.length > 0 ? social.slice(-8) : s.social,
      retrievals: retrieval && retrieval.length > 0 ? retrieval.slice(-30) : s.retrievals,
      memorySizes: memory && Object.keys(memory).length > 0 ? memory : s.memorySizes,
      control: control ?? s.control,
      artifacts: artifacts ?? s.artifacts,
    });
  },
}));

/** Zone key dari payload → label aktivitas live (PRD: "ACTIVE DEBATE"). */
export function zoneActivitySuffix(
  zone: TargetZoneAlias,
  agents: Partial<Record<AgentId, AgentStatusPayload>>,
  now: number,
): string | null {
  let suffix: string | null = null;
  for (const a of Object.values(agents)) {
    if (!a || a.targetZone !== zone) continue;
    const at = parseBrainTimestamp(a.timestamp);
    if (now - at > STALE_MS) continue; // status basi tidak menyalakan label
    const text = ZONE_ACTIVITY[a.currentAction];
    if (text) suffix = text;
  }
  return suffix;
}
