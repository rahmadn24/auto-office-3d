import { create } from 'zustand';

import type { ZoneKey } from '@/lib/zones';

/** State matrix animasi — PRD §4.2. */
export type AnimState = 'IDLE' | 'WORKING' | 'WALKING' | 'CELEBRATE';

export type AgentId =
  'founder_agent' | 'pm_agent' | 'dev_agent' | 'qa_agent' | 'devops_agent' | 'marketing_agent';

/** 5 preset cinematic + orbit bebas (PRD §4.3). */
export type CameraPresetKey = 'overview' | 'founder' | 'devLab' | 'meeting' | 'devOps' | 'orbit';

export interface AgentRosterEntry {
  id: AgentId;
  /** Nama untuk speech bubble, contoh: "PM Agent". */
  name: string;
  division: 'Product' | 'Engineering' | 'QA' | 'DevOps' | 'Growth';
  /** Warna rompi divisi. */
  color: string;
  homeZone: ZoneKey;
  /** Posisi rumah di atas kursi (Y = permukaan pad zona). */
  home: readonly [number, number, number];
  /** Arah hadap (radian) — menghadap meja masing-masing. */
  facing: number;
}

export interface AgentRuntime {
  state: AnimState;
  log: string;
  logAt: number;
  /** Tujuan berjalan (WALKING), kosong bila diam di tempat. */
  target?: readonly [number, number, number];
  /** State yang diberikan setelah tiba di tujuan. */
  pending?: AnimState;
}

/**
 * Roster 6 agen — posisi kursi = koordinat zona PRD §4.1 + offset meja
 * (lihat theater/components/scene/Furniture.tsx).
 */
export const AGENT_ROSTER: readonly AgentRosterEntry[] = [
  {
    id: 'founder_agent',
    name: 'Founder',
    division: 'Product',
    color: '#6366f1',
    homeZone: 'founder_desk',
    home: [-14, 0.4, 14.4],
    facing: Math.PI,
  },
  {
    id: 'pm_agent',
    name: 'PM Agent',
    division: 'Product',
    color: '#818cf8',
    homeZone: 'meeting_room',
    home: [-13, 0.4, -10.3],
    facing: Math.PI,
  },
  {
    id: 'dev_agent',
    name: 'Dev Agent',
    division: 'Engineering',
    color: '#10b981',
    homeZone: 'dev_lab',
    home: [10.4, 0.4, -12.2],
    facing: Math.PI,
  },
  {
    id: 'qa_agent',
    name: 'QA Runner',
    division: 'QA',
    color: '#06b6d4',
    homeZone: 'dev_lab',
    home: [14, 0.4, -11.4],
    facing: 0,
  },
  {
    id: 'devops_agent',
    name: 'DevOps',
    division: 'DevOps',
    color: '#f59e0b',
    homeZone: 'devops_hub',
    home: [0, 0.4, 19.7],
    facing: Math.PI,
  },
  {
    id: 'marketing_agent',
    name: 'Growth Agent',
    division: 'Growth',
    color: '#ec4899',
    homeZone: 'marketing_studio',
    home: [10.8, 0.4, 12],
    facing: Math.PI,
  },
];

const BUBBLE_SAMPLE: Record<AgentId, string> = {
  founder_agent: 'Inject live directive to Founder…',
  pm_agent: 'Synthesizing PRD specs…',
  dev_agent: 'Emitting src/routes + src/lib/stripe.ts (cycle 1/5)',
  qa_agent: '18/18 Vitest tests passed · stmts 100%',
  devops_agent: 'edge_provision → build READY · health 200 OK',
  marketing_agent: 'Launch thread dispatched · listening for Stripe webhook',
};

function initialAgents(): Record<AgentId, AgentRuntime> {
  const now = Date.now();
  return Object.fromEntries(
    AGENT_ROSTER.map((entry) => [
      entry.id,
      { state: 'IDLE', log: BUBBLE_SAMPLE[entry.id], logAt: now } satisfies AgentRuntime,
    ]),
  ) as Record<AgentId, AgentRuntime>;
}

/** Titik berkumpul di sekitar hub_00 (lingkaran radius 3.4) untuk CELEBRATE. */
export function celebrationSpot(index: number): readonly [number, number, number] {
  const angle = (index / AGENT_ROSTER.length) * Math.PI * 2;
  return [Math.cos(angle) * 3.4, 0.4, Math.sin(angle) * 3.4];
}

interface OfficeStore {
  agents: Record<AgentId, AgentRuntime>;
  cameraPreset: CameraPresetKey;
  /** true bila ada agen berstate CELEBRATE (memicu konfeti). */
  celebrating: boolean;
  setState(id: AgentId, state: AnimState, log?: string): void;
  setLog(id: AgentId, log: string): void;
  /** Agen berjalan (lerp) ke titik tujuan, lalu state `pending` (default IDLE). */
  walkTo(
    id: AgentId,
    target: readonly [number, number, number],
    pending?: AnimState,
    log?: string,
  ): void;
  /** Dipanggil rig saat tiba di tujuan. */
  arrive(id: AgentId): void;
  /** Semua agen berjalan ke hub lalu CELEBRATE (milestone first sale). */
  celebrateAll(log?: string): void;
  /** Semua agen berjalan pulang ke kursinya. */
  resetHome(log?: string): void;
  setCameraPreset(preset: CameraPresetKey): void;
}

const storeLog = (log: string): { log: string; logAt: number } => ({ log, logAt: Date.now() });

export const useOffice = create<OfficeStore>((set, get) => ({
  agents: initialAgents(),
  cameraPreset: 'overview',
  celebrating: false,

  setState: (id, state, log) =>
    set((s) => ({
      agents: {
        ...s.agents,
        [id]: {
          ...s.agents[id],
          state,
          ...(log !== undefined ? storeLog(log) : {}),
        },
      },
    })),

  setLog: (id, log) =>
    set((s) => ({ agents: { ...s.agents, [id]: { ...s.agents[id], ...storeLog(log) } } })),

  walkTo: (id, target, pending = 'IDLE', log) =>
    set((s) => ({
      agents: {
        ...s.agents,
        [id]: {
          ...s.agents[id],
          state: 'WALKING',
          target,
          pending,
          ...(log !== undefined ? storeLog(log) : {}),
        },
      },
    })),

  arrive: (id) => {
    const runtime = get().agents[id];
    const next = runtime.pending ?? 'IDLE';
    set((s) => {
      const agents = {
        ...s.agents,
        [id]: { ...runtime, state: next, target: undefined, pending: undefined },
      };
      const celebrating = Object.values(agents).some((a) => a.state === 'CELEBRATE');
      return { agents, celebrating };
    });
  },

  celebrateAll: (log) => {
    const s = get();
    const agents = { ...s.agents } as Record<AgentId, AgentRuntime>;
    AGENT_ROSTER.forEach((entry, index) => {
      agents[entry.id] = {
        ...agents[entry.id],
        state: 'WALKING',
        target: celebrationSpot(index),
        pending: 'CELEBRATE',
        ...(log !== undefined
          ? storeLog(log)
          : { ...storeLog('FIRST CUSTOMER ACQUIRED ($29.00) → CELEBRATE!') }),
      };
    });
    set({ agents });
  },

  resetHome: (log) => {
    const agents = { ...get().agents } as Record<AgentId, AgentRuntime>;
    for (const entry of AGENT_ROSTER) {
      agents[entry.id] = {
        ...agents[entry.id],
        state: 'WALKING',
        target: entry.home,
        pending: 'IDLE',
        ...(log !== undefined ? storeLog(log) : {}),
      };
    }
    set({ agents, celebrating: false });
  },

  setCameraPreset: (preset) => set({ cameraPreset: preset }),
}));
