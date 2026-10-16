'use client';

import { io, type Socket } from 'socket.io-client';

import {
  parseAgentStatus,
  parseArtifacts,
  parseDeployUpdate,
  parseFirstSale,
  parseMemoryRetrieval,
  parseRevenueUpdate,
  parseSocialPost,
  type AgentStatusPayload,
} from '@/lib/events';
import { useBrain } from '@/store/brainStore';
import { AGENT_ROSTER, useOffice, type AnimState, type AgentId } from '@/store/officeStore';
import { ZONE_BY_KEY, type ZoneKey } from '@/lib/zones';

/**
 * Klien Socket.io Brain ↔ Theater — PRD §2.1 (WebSockets + polling fallback,
 * WSS di produksi). Menjalankan satu koneksi singleton; auto-reconnect bawaan
 * Socket.io (reconnection: true). Setiap payload divalidasi Zod sebelum menyentuh
 * store (skema duplikat, lihat lib/events.ts).
 *
 * Endpoint: ws://localhost:4800/brain-server (env NEXT_PUBLIC_BRAIN_URL override).
 */

const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_URL ?? 'http://localhost:4800';
const BRAIN_PATH = process.env.NEXT_PUBLIC_BRAIN_PATH ?? '/brain-server';

let socket: Socket | null = null;
/** Interval probe ping round-trip (badge PING xxms). */
let pingTimer: ReturnType<typeof setInterval> | null = null;

/** Titik duduk/berdiri agen di zona target (dari roster home). */
function agentHome(id: string): readonly [number, number, number] {
  return AGENT_ROSTER.find((a) => a.id === id)?.home ?? [0, 0.4, 0];
}

/** Waypoint tengah zona — dipakai saat payload coordinates tidak ada. */
function zoneWaypoint(zone: ZoneKey): readonly [number, number, number] {
  const z = ZONE_BY_KEY[zone];
  return z ? (z.position as readonly [number, number, number]) : [0, 0.4, 0];
}

/** Bridge payload status → store 3D (gerak + bubble + state animasi). */
function bridgeTo3D(agentId: AgentId, payload: AgentStatusPayload): void {
  const office = useOffice.getState();
  if (!AGENT_ROSTER.some((a) => a.id === agentId)) return;

  const anim: AnimState =
    payload.currentAction === 'idle'
      ? 'IDLE'
      : payload.currentAction === 'walking'
        ? 'WALKING'
        : payload.currentAction === 'celebrating'
          ? 'CELEBRATE'
          : 'WORKING';

  const target: readonly [number, number, number] = payload.coordinates
    ? [payload.coordinates.x, payload.coordinates.y, payload.coordinates.z]
    : agentHome(agentId);

  const runtime = office.agents[agentId];
  const alreadyNear = runtime && runtime.target === undefined;

  if (anim === 'CELEBRATE') {
    office.walkTo(agentId, zoneWaypoint('central_bus'), 'CELEBRATE', payload.logMessage);
  } else if (anim === 'WALKING') {
    office.walkTo(agentId, target, 'WORKING', payload.logMessage);
  } else if (alreadyNear) {
    office.setState(agentId, anim, payload.logMessage);
  } else {
    office.walkTo(agentId, target, anim, payload.logMessage);
  }
}

/** Tarik snapshot sekali setiap (re)connect — PRD: state terbaru ditarik sekali. */
function requestSnapshot(s: Socket): void {
  s.emit('state:request', () => {
    /* ack dari brain; snapshot juga dikirim lewat event state:snapshot */
  });
}

export function connectBrain(): Socket {
  if (socket) return socket;

  const brain = useBrain.getState();
  brain.setConnection('connecting');

  socket = io(BRAIN_URL, {
    path: BRAIN_PATH,
    // WebSocket dulu; bila diblokir jaringan → long-polling fallback (PRD §2.1).
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 8000,
  });

  socket.on('connect', () => {
    useBrain.getState().setConnection('connected');
    // Tarik snapshot terbaru tiap (re)connect — fresh load / deep-link per tab
    // langsung terisi state terakhir (run sudah selesai sebelum tab dibuka).
    if (socket) requestSnapshot(socket);
  });

  socket.on('disconnect', () => {
    useBrain.getState().setConnection('reconnecting');
  });

  socket.on('connect_error', () => {
    useBrain.getState().setConnection('offline');
  });

  // Ping round-trip → badge PING xxms (PRD §2.1). Manager Socket.io tak
  // mengekspos latensi (emitReserved tanpa arg), jadi kita ukur sendiri lewat
  // echo `sys:ping` ke brain — tiap 5s selama tersambung.
  pingTimer = setInterval(() => {
    if (socket && socket.connected) {
      const t0 = Date.now();
      socket.emit('sys:ping', () => {
        useBrain.getState().setPing(Date.now() - t0);
      });
    }
  }, 5000);

  socket.on('system:hello', (hello: unknown) => {
    const v = (hello as { version?: unknown } | null)?.version;
    if (typeof v === 'string') useBrain.getState().setBrainVersion(v);
  });

  socket.on('state:snapshot', (snapshot: unknown) => {
    const s = snapshot as {
      agents?: unknown[];
      milestones?: unknown[];
      deploy?: unknown;
      revenue?: unknown;
      social?: unknown[];
      retrieval?: unknown[];
      memory?: Record<string, number>;
      control?: { haltedAll?: boolean; runIds?: string[] };
      artifacts?: unknown;
    } | null;
    if (!s) return;
    const agents = (s.agents ?? [])
      .map((a) => parseAgentStatus(a))
      .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
      .map((r) => r.payload);
    const milestones = (s.milestones ?? [])
      .map((m) => parseFirstSale(m))
      .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
      .map((r) => r.payload);
    const deploy = s.deploy ? parseDeployUpdate(s.deploy) : null;
    const revenue = s.revenue ? parseRevenueUpdate(s.revenue) : null;
    const social = (s.social ?? [])
      .map((p) => parseSocialPost(p))
      .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
      .map((r) => r.payload);
    const retrieval = (s.retrieval ?? [])
      .map((r) => parseMemoryRetrieval(r))
      .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
      .map((r) => r.payload);
    const artifacts = s.artifacts ? parseArtifacts(s.artifacts) : null;
    useBrain.getState().hydrateSnapshot({
      agents,
      milestones,
      deploy: deploy && deploy.ok ? deploy.payload : null,
      revenue: revenue && revenue.ok ? revenue.payload : null,
      social,
      retrieval,
      memory: s.memory,
      control: s.control
        ? { haltedAll: Boolean(s.control.haltedAll), runIds: s.control.runIds ?? [] }
        : undefined,
      artifacts: artifacts && artifacts.ok ? artifacts.payload : null,
    });
    for (const a of agents) bridgeTo3D(a.agentId, a);
  });

  socket.on('agent:status_update', (raw: unknown) => {
    const parsed = parseAgentStatus(raw);
    if (!parsed.ok) {
      console.warn('[theater] agent:status_update DITOLAK:', parsed.issues);
      return;
    }
    const applied = useBrain.getState().applyStatus(parsed.payload);
    if (applied) bridgeTo3D(parsed.payload.agentId, parsed.payload);
  });

  socket.on('milestone:first_sale', (raw: unknown) => {
    const parsed = parseFirstSale(raw);
    if (!parsed.ok) {
      console.warn('[theater] milestone:first_sale DITOLAK:', parsed.issues);
      return;
    }
    const applied = useBrain.getState().applyMilestone(parsed.payload);
    // Idempoten: hanya event baru yang memicu CELEBRATE global.
    if (applied) useOffice.getState().celebrateAll(`FIRST SALE · ${parsed.payload.customer.city}`);
  });

  socket.on('deploy:update', (raw: unknown) => {
    const parsed = parseDeployUpdate(raw);
    if (!parsed.ok) {
      console.warn('[theater] deploy:update DITOLAK:', parsed.issues);
      return;
    }
    useBrain.getState().applyDeploy(parsed.payload);
  });

  socket.on('revenue:update', (raw: unknown) => {
    const parsed = parseRevenueUpdate(raw);
    if (!parsed.ok) {
      console.warn('[theater] revenue:update DITOLAK:', parsed.issues);
      return;
    }
    useBrain.getState().applyRevenue(parsed.payload);
  });

  socket.on('social:post', (raw: unknown) => {
    const parsed = parseSocialPost(raw);
    if (!parsed.ok) {
      console.warn('[theater] social:post DITOLAK:', parsed.issues);
      return;
    }
    useBrain.getState().applySocial(parsed.payload);
  });

  socket.on('memory:retrieval', (raw: unknown) => {
    const parsed = parseMemoryRetrieval(raw);
    if (!parsed.ok) {
      console.warn('[theater] memory:retrieval DITOLAK:', parsed.issues);
      return;
    }
    useBrain.getState().applyRetrieval(parsed.payload);
  });

  socket.on('artifacts:ready', (raw: unknown) => {
    const parsed = parseArtifacts(raw);
    if (!parsed.ok) {
      console.warn('[theater] artifacts:ready DITOLAK:', parsed.issues);
      return;
    }
    useBrain.getState().applyArtifacts(parsed.payload);
  });

  socket.on('control:state', (raw: unknown) => {
    const s = raw as { haltedAll?: unknown; runIds?: unknown } | null;
    if (!s || typeof s !== 'object') return;
    useBrain.getState().applyControl({
      haltedAll: Boolean(s.haltedAll),
      runIds: Array.isArray(s.runIds)
        ? s.runIds.filter((r): r is string => typeof r === 'string')
        : [],
    });
  });

  return socket;
}

/** SIMULATE WEBHOOK (kartu 💳) — minta Brain memancarkan transaksi $29 demo. */
export function simulateWebhook(runId?: string): void {
  socket?.emit('stripe:simulate', { runId: runId ?? 'simulated_run' });
}

/**
 * FOUNDER PROMPT (PRD §3.1) — kirim satu directive founder ke Brain
 * (`founder:directive`). Mengembalikan hasil ack: `{ ok: true }` bila Brain
 * menerima & menjalankan run autonomous; `{ ok: false, error }` bila socket
 * tidak tersambung / prompt kosong / nack.
 */
export async function sendFounderDirective(
  prompt: string,
): Promise<{ ok: boolean; error?: string }> {
  const text = prompt.trim();
  if (!text) return { ok: false, error: 'empty directive' };
  if (!socket || !socket.connected) {
    return { ok: false, error: 'brain offline — sambungkan socket dulu' };
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'ack timeout (5s)' }), 5000);
    socket?.emit('founder:directive', text, (ack: unknown) => {
      clearTimeout(timer);
      const a = ack as { ok?: unknown; error?: unknown } | null;
      if (a && a.ok === true) resolve({ ok: true });
      else resolve({ ok: false, error: typeof a?.error === 'string' ? a.error : 'nack' });
    });
  });
}

/** LOOP CONTROLS — HALT/RESUME seluruh graph (PRD §3.2). */
export function setGraphHalt(halted: boolean, runId?: string): void {
  socket?.emit(halted ? 'control:halt' : 'control:resume', { runId });
}

export function getBrainSocket(): Socket | null {
  return socket;
}

export function disconnectBrain(): void {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  socket?.disconnect();
  socket = null;
  useBrain.getState().setConnection('offline');
}
