'use client';

import { io, type Socket } from 'socket.io-client';

import {
  parseAgentStatus,
  parseArtifacts,
  parseBrief,
  parseBudgetUpdate,
  parseChatTurn,
  parseDeployUpdate,
  parseFirstSale,
  parseLead,
  parseLeadUpdate,
  parseMemoryRetrieval,
  parsePaymentLink,
  parseReplayFrame,
  parseRevenueUpdate,
  parseRunRecord,
  parseSocialPost,
  type AgentStatusPayload,
  type BriefPayload,
  type ChatTurnPayload,
  type InboxEntry,
} from '@/lib/events';
import { useBriefing } from '@/store/briefingStore';
import { useBrain } from '@/store/brainStore';
import { useCsInbox, type CsQuoteResult, type CsSweepSummary } from '@/store/csStore';
import { useReplay } from '@/store/replayStore';
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

/** URL HTTP Brain (halaman demo widget, kontrak PDF, health) — dipakai UI theater. */
export function brainHttpUrl(pathname: string): string {
  const base = BRAIN_URL.replace(/\/+$/, '');
  return `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

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
    : payload.currentAction === 'walking'
      ? zoneWaypoint(payload.targetZone)
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

/** Validasi satu entri CS Inbox (ack `cs:list` & snapshot `leads`). */
function parseInboxEntry(raw: unknown): InboxEntry | null {
  const entryRaw = raw as { lead?: unknown; lastMessage?: unknown; messageCount?: unknown } | null;
  if (!entryRaw) return null;
  const lead = parseLead(entryRaw.lead);
  if (!lead.ok) return null;
  const last = entryRaw.lastMessage == null ? null : parseChatTurn(entryRaw.lastMessage);
  return {
    lead: lead.payload,
    lastMessage: last && last.ok ? last.payload : null,
    messageCount: typeof entryRaw.messageCount === 'number' ? entryRaw.messageCount : 0,
  };
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

  function probePing(): void {
    if (socket && socket.connected) {
      const t0 = Date.now();
      socket.emit('sys:ping', () => {
        useBrain.getState().setPing(Date.now() - t0);
      });
    }
  }

  socket.on('connect', () => {
    useBrain.getState().setConnection('connected');
    // Tarik snapshot terbaru tiap (re)connect — fresh load / deep-link per tab
    // langsung terisi state terakhir (run sudah selesai sebelum tab dibuka).
    if (socket) requestSnapshot(socket);
    // Probe pertama langsung: badge PING tidak kosong 5 detik pertama.
    probePing();
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
  pingTimer = setInterval(probePing, 5000);

  socket.on('system:hello', (hello: unknown) => {
    const h = hello as {
      version?: unknown;
      budget?: unknown;
    } | null;
    if (typeof h?.version === 'string') useBrain.getState().setBrainVersion(h.version);
    // Fase 13 — status budget harian lintas-run saat (re)connect.
    const budget = h?.budget ? parseBudgetUpdate(h.budget) : null;
    if (budget?.ok) useBrain.getState().setBudget(budget.payload);
  });

  // Fase 13 — budget berubah setelah run selesai / run ditolak.
  socket.on('budget:update', (raw: unknown) => {
    const parsed = parseBudgetUpdate(raw);
    if (parsed.ok) useBrain.getState().setBudget(parsed.payload);
  });

  socket.on('state:snapshot', (snapshot: unknown) => {
    const s = snapshot as {
      agents?: unknown[];
      milestones?: unknown[];
      deploy?: unknown;
      revenue?: unknown;
      social?: unknown[];
      retrieval?: unknown[];
      runs?: unknown[];
      leads?: unknown[];
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
    // Fase 10 — run history durable untuk panel Event Replay.
    const runs = (s.runs ?? [])
      .map((run) => parseRunRecord(run))
      .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
      .map((r) => r.payload);
    useReplay.getState().setRuns(runs);
    // Fase 11 — CS Inbox terisi langsung saat fresh load / deep-link tab.
    const leads = (s.leads ?? []).map(parseInboxEntry).filter((e): e is InboxEntry => e !== null);
    useCsInbox.getState().setEntries(leads);
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
      latestRun: runs[0]
        ? { runId: runs[0].runId, status: runs[0].status, stage: runs[0].stage }
        : null,
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

  // Fase 8 — Briefing Room: balasan PM untuk founder:chat (broadcast dari brain).
  socket.on('pm:reply', (raw: unknown) => {
    const parsed = parseChatTurn(raw);
    if (!parsed.ok) {
      console.warn('[theater] pm:reply DITOLAK:', parsed.issues);
      return;
    }
    useBriefing.getState().applyReply(parsed.payload);
  });

  // Fase 10 — Event Replay: frame playback run masa lalu (start → event* → end).
  socket.on('run:replay', (raw: unknown) => {
    const parsed = parseReplayFrame(raw);
    if (!parsed.ok) {
      console.warn('[theater] run:replay DITOLAK:', parsed.issues);
      return;
    }
    const frame = parsed.payload;
    if (frame.phase === 'start') useReplay.getState().begin(frame.runId, frame.total);
    else useReplay.getState().applyFrame(frame);
  });

  // Fase 11 — CS Agent: lead berubah (handoff/status/quote), balasan CS, & link.
  socket.on('lead:update', (raw: unknown) => {
    const parsed = parseLeadUpdate(raw);
    if (!parsed.ok) {
      console.warn('[theater] lead:update DITOLAK:', parsed.issues);
      return;
    }
    useCsInbox.getState().applyUpdate(parsed.payload);
  });

  socket.on('cs:message', (raw: unknown) => {
    const parsed = parseChatTurn(raw);
    if (!parsed.ok) {
      console.warn('[theater] cs:message DITOLAK:', parsed.issues);
      return;
    }
    useCsInbox.getState().pushTurn(parsed.payload);
  });

  socket.on('payment:link_created', (raw: unknown) => {
    const parsed = parsePaymentLink(raw);
    if (!parsed.ok) {
      console.warn('[theater] payment:link_created DITOLAK:', parsed.issues);
      return;
    }
    useCsInbox.getState().applyPaymentLink(parsed.payload);
  });

  return socket;
}

/** SIMULATE PAYMENT (kartu 💳) — pinta Brain memancarkan transaksi demo via driver aktif. */
export function simulateWebhook(runId?: string): void {
  socket?.emit('payment:simulate', { runId: runId ?? 'simulated_run' });
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

/* ───────── Fase 8 — Briefing Room (PRD §3.1, §5.3) ───────── */

/**
 * Kirim satu pesan founder ke PM (`founder:chat`). Balasan menyusul lewat
 * event `pm:reply` → store briefing. Ack = konsisten dengan founder:directive.
 */
export async function sendFounderChat(
  conversationId: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const text = message.trim();
  if (!text) return { ok: false, error: 'empty message' };
  if (!socket || !socket.connected) {
    return { ok: false, error: 'brain offline — sambungkan socket dulu' };
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'ack timeout (5s)' }), 5000);
    socket?.emit('founder:chat', { conversationId, message: text }, (ack: unknown) => {
      clearTimeout(timer);
      const a = ack as { ok?: unknown; error?: unknown } | null;
      if (a && a.ok === true) resolve({ ok: true });
      else resolve({ ok: false, error: typeof a?.error === 'string' ? a.error : 'nack' });
    });
  });
}

/** Riwayat thread briefing durable dari brain (reload/restart tetap ada). */
export function fetchBriefingHistory(conversationId: string): Promise<ChatTurnPayload[]> {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve([]);
      return;
    }
    const timer = setTimeout(() => resolve([]), 5000);
    socket?.emit('briefing:history', { conversationId }, (ack: unknown) => {
      clearTimeout(timer);
      const a = ack as { ok?: unknown; turns?: unknown[] } | null;
      if (!a || a.ok !== true || !Array.isArray(a.turns)) {
        resolve([]);
        return;
      }
      resolve(
        a.turns
          .map((t) => parseChatTurn(t))
          .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
          .map((r) => r.payload),
      );
    });
  });
}

/** GO — compile thread jadi brief terstruktur (audience, fitur, preset, harga). */
export function compileBrief(
  conversationId: string,
): Promise<{ ok: true; brief: BriefPayload } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve({ ok: false, error: 'brain offline — sambungkan socket dulu' });
      return;
    }
    const timer = setTimeout(() => resolve({ ok: false, error: 'ack timeout (15s)' }), 15_000);
    socket?.emit('brief:compile', { conversationId }, (ack: unknown) => {
      clearTimeout(timer);
      const a = ack as { ok?: unknown; error?: unknown; brief?: unknown } | null;
      if (!a || a.ok !== true) {
        resolve({ ok: false, error: typeof a?.error === 'string' ? a.error : 'nack' });
        return;
      }
      const parsed = parseBrief(a.brief);
      if (!parsed.ok) {
        resolve({ ok: false, error: `brief tidak valid: ${parsed.issues}` });
        return;
      }
      resolve({ ok: true, brief: parsed.payload });
    });
  });
}

/* ───────── Fase 10 — Event Replay (kartu 10.4) ───────── */

/**
 * Putar ulang run masa lalu: ack berisi total event, lalu brain
 * men-stream frame `run:replay` (start → event* → end) ke socket ini.
 */
export function replayRun(
  runId: string,
  options: { stepMs?: number; limit?: number } = {},
): Promise<{ ok: boolean; total?: number; error?: string }> {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve({ ok: false, error: 'brain offline — sambungkan socket dulu' });
      return;
    }
    const timer = setTimeout(() => resolve({ ok: false, error: 'ack timeout (5s)' }), 5000);
    socket.emit(
      'run:replay',
      { runId, stepMs: options.stepMs, limit: options.limit },
      (ack: unknown) => {
        clearTimeout(timer);
        const a = ack as { ok?: unknown; total?: unknown; error?: unknown } | null;
        if (a && a.ok === true) {
          const total = typeof a.total === 'number' ? a.total : 0;
          useReplay.getState().begin(runId, total);
          resolve({ ok: true, total });
          return;
        }
        const error = typeof a?.error === 'string' ? a.error : 'nack';
        useReplay.getState().fail(error);
        resolve({ ok: false, error });
      },
    );
  });
}

/** Hentikan playback yang sedang berjalan (brain berhenti mengirim frame). */
export function cancelReplay(): void {
  useReplay.getState().stop();
  socket?.emit('run:replay', { cancel: true });
}

/* ───────── Fase 11 — CS Agent: omnichannel inbox + closing (PRD §3.5) ───────── */

/** Ringkasan CS Inbox dari brain (lead + pesan terakhir + jumlah pesan). */
export function fetchCsInbox(limit = 50): Promise<InboxEntry[]> {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve([]);
      return;
    }
    const timer = setTimeout(() => resolve([]), 5000);
    socket.emit('cs:list', { limit }, (ack: unknown) => {
      clearTimeout(timer);
      const a = ack as { ok?: unknown; entries?: unknown[] } | null;
      if (!a || a.ok !== true || !Array.isArray(a.entries)) {
        resolve([]);
        return;
      }
      resolve(a.entries.map(parseInboxEntry).filter((e): e is InboxEntry => e !== null));
    });
  });
}

/** Transkrip satu percakapan client (durable di brain `cs_messages`). */
export function fetchCsHistory(conversationId: string): Promise<ChatTurnPayload[]> {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve([]);
      return;
    }
    const timer = setTimeout(() => resolve([]), 5000);
    socket.emit('cs:history', { conversationId }, (ack: unknown) => {
      clearTimeout(timer);
      const a = ack as { ok?: unknown; turns?: unknown[] } | null;
      if (!a || a.ok !== true || !Array.isArray(a.turns)) {
        resolve([]);
        return;
      }
      resolve(
        a.turns
          .map((t) => parseChatTurn(t))
          .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
          .map((r) => r.payload),
      );
    });
  });
}

/** Quote manual dari CS Inbox: payment link + kontrak PDF dikirim ke client. */
export function requestCsQuote(input: {
  leadId: string;
  amount?: number;
  currency?: 'USD' | 'IDR';
  productName?: string;
}): Promise<{ ok: true; quote: CsQuoteResult } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve({ ok: false, error: 'brain offline — sambungkan socket dulu' });
      return;
    }
    const timer = setTimeout(() => resolve({ ok: false, error: 'ack timeout (15s)' }), 15_000);
    socket.emit('cs:quote', input, (ack: unknown) => {
      clearTimeout(timer);
      const a = ack as {
        ok?: unknown;
        error?: unknown;
        link?: unknown;
        contractUrl?: unknown;
      } | null;
      if (!a || a.ok !== true || typeof a.contractUrl !== 'string') {
        resolve({ ok: false, error: typeof a?.error === 'string' ? a.error : 'nack' });
        return;
      }
      const checkoutUrl = (a.link as { checkoutUrl?: unknown } | null)?.checkoutUrl;
      const quote: CsQuoteResult = {
        leadId: input.leadId,
        checkoutUrl: typeof checkoutUrl === 'string' ? checkoutUrl : '',
        contractUrl: a.contractUrl,
      };
      useCsInbox.getState().setLastQuote(quote);
      resolve({ ok: true, quote });
    });
  });
}

/** Jalankan follow-up engine sekarang (tombol demo; scheduler brain tetap jalan). */
export function runCsSweep(
  force = true,
): Promise<{ ok: true; summary: CsSweepSummary } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve({ ok: false, error: 'brain offline — sambungkan socket dulu' });
      return;
    }
    const timer = setTimeout(() => resolve({ ok: false, error: 'ack timeout (15s)' }), 15_000);
    socket.emit('cs:sweep', { force }, (ack: unknown) => {
      clearTimeout(timer);
      const a = ack as {
        ok?: unknown;
        error?: unknown;
        checked?: unknown;
        sent?: unknown;
        templates?: unknown;
        lost?: unknown;
      } | null;
      if (!a || a.ok !== true) {
        resolve({ ok: false, error: typeof a?.error === 'string' ? a.error : 'nack' });
        return;
      }
      const summary: CsSweepSummary = {
        checked: typeof a.checked === 'number' ? a.checked : 0,
        sent: typeof a.sent === 'number' ? a.sent : 0,
        templates: typeof a.templates === 'number' ? a.templates : 0,
        lost: typeof a.lost === 'number' ? a.lost : 0,
      };
      useCsInbox.getState().setLastSweep(summary);
      resolve({ ok: true, summary });
    });
  });
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
