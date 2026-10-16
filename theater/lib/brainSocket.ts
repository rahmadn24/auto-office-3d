'use client';

import { io, type Socket } from 'socket.io-client';

import { parseAgentStatus, parseFirstSale, type AgentStatusPayload } from '@/lib/events';
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
/** true bila pernah terhubung — snapshot hanya ditarik saat (re)connect. */
let hasConnectedOnce = false;

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
    // Auto-reconnect: tarik snapshot terbaru sekali per koneksi.
    if (hasConnectedOnce && socket) requestSnapshot(socket);
    hasConnectedOnce = true;
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
    useBrain.getState().hydrateSnapshot({ agents, milestones });
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

  return socket;
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
  hasConnectedOnce = false;
  useBrain.getState().setConnection('offline');
}
