import { create } from 'zustand';

import type { AgentStatusPayload, AgentId, FirstSalePayload } from '@/lib/events';
import type { ZoneKey } from '@/lib/zones';

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
const STALE_MS = 5_000;

let feedSeq = 0;
const nextFeedId = (): string => `f${(feedSeq += 1)}`;

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
  /** Stage run aktif, diturunkan dari aksi mayoritas (mis. BUILDING). */
  runStage: string | null;
  runId: string | null;
  /** Token terakumulasi (max telemetry yang pernah terlihat). */
  tokens: number;
  feed: FeedItem[];
  hasCustomers: boolean;
  milestone: FirstSalePayload | null;
  /** stripeEventId yang sudah diproses — idempoten (PRD §5.2). */
  seenSaleIds: Set<string>;
  /** Epoch ms event terakhir — untuk deteksi stale & events/sec. */
  lastEventAt: number | null;
  /** Jumlah event status diterima sepanjang sesi. */
  eventCount: number;

  setConnection(status: ConnectionStatus): void;
  setPing(ms: number): void;
  setBrainVersion(v: string): void;
  /** Terapkan payload status: validasi, diff update agent, dorong feed. */
  applyStatus(payload: AgentStatusPayload): boolean;
  /** Terapkan milestone first sale — idempoten per stripeEventId. */
  applyMilestone(payload: FirstSalePayload): boolean;
  /** Hapus semua baris feed (tombol CLEAR FEED). */
  clearFeed(): void;
  /** Ambil ulang snapshot setelah reconnect. */
  hydrateSnapshot(snapshot: {
    agents?: AgentStatusPayload[];
    milestones?: FirstSalePayload[];
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
  const order = STAGE_ORDER as readonly string[];
  for (const a of Object.values(agents)) {
    if (!a) continue;
    // 'walking' tidak ada di STAGE_ORDER → indexOf -1 (diabaikan).
    const idx = order.indexOf(a.currentAction);
    if (idx > best) best = idx;
  }
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
  runStage: null,
  runId: null,
  tokens: 0,
  feed: [],
  hasCustomers: false,
  milestone: null,
  seenSaleIds: new Set<string>(),
  lastEventAt: null,
  eventCount: 0,

  setConnection: (connection) => set({ connection }),
  setPing: (pingMs) => set({ pingMs }),
  setBrainVersion: (brainVersion) => set({ brainVersion }),

  applyStatus: (payload) => {
    const s = get();
    const now = Date.now();

    // Diff update: hanya ganti bila payload lebih baru dari yang tersimpan.
    const prev = s.agents[payload.agentId];
    if (prev && prev.timestamp >= payload.timestamp) return false;

    const at = parseBrainTimestamp(payload.timestamp);
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

    set({
      agents,
      feed,
      runStage: deriveRunStage(agents),
      runId: payload.runId,
      tokens: Math.max(s.tokens, payload.telemetry?.tokensUsed ?? 0),
      latencyMs: latency,
      bestLatencyMs: best,
      lastEventAt: now,
      eventCount: s.eventCount + 1,
    });
    return true;
  },

  applyMilestone: (payload) => {
    const s = get();
    if (s.seenSaleIds.has(payload.stripeEventId)) return false;
    const seen = new Set(s.seenSaleIds);
    seen.add(payload.stripeEventId);
    const at = parseBrainTimestamp(payload.timestamp);
    const item: FeedItem = {
      id: nextFeedId(),
      agentId: 'marketing_agent',
      division: 'Growth',
      action: 'milestone:first_sale',
      targetZone: 'central_bus',
      detail: `${payload.customer.city}, ${payload.customer.country} · $${payload.amount.toFixed(2)} ${payload.currency} · ${payload.customer.maskedEmail}`,
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

  hydrateSnapshot: ({ agents, milestones }) => {
    const s = get();
    const map: Partial<Record<AgentId, AgentStatusPayload>> = { ...s.agents };
    for (const a of agents ?? []) {
      const prev = map[a.agentId];
      if (!prev || prev.timestamp < a.timestamp) map[a.agentId] = a;
    }
    let hasCustomers = s.hasCustomers;
    let milestone = s.milestone;
    const seen = new Set(s.seenSaleIds);
    const feed = [...s.feed];
    for (const m of milestones ?? []) {
      if (seen.has(m.stripeEventId)) continue;
      seen.add(m.stripeEventId);
      hasCustomers = true;
      milestone = m;
      feed.push({
        id: nextFeedId(),
        agentId: 'marketing_agent',
        division: 'Growth',
        action: 'milestone:first_sale',
        targetZone: 'central_bus',
        detail: `${m.customer.city} · $${m.amount.toFixed(2)}`,
        at: Date.now(),
        tsLabel: m.timestamp,
        runId: m.runId,
        kind: 'milestone',
      });
    }
    set({
      agents: map,
      hasCustomers,
      milestone,
      seenSaleIds: seen,
      runStage: deriveRunStage(map),
      feed: feed.slice(0, MAX_FEED),
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
