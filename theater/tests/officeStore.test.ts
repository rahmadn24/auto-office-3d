import { beforeEach, describe, expect, it } from 'vitest';

import {
  AGENT_ROSTER,
  celebrationSpot,
  useOffice,
  type AgentId,
  type AgentRuntime,
} from '../store/officeStore';

function freshAgents(): Record<AgentId, AgentRuntime> {
  return Object.fromEntries(
    AGENT_ROSTER.map((entry) => [entry.id, { state: 'IDLE', log: '', logAt: 0 }]),
  ) as Record<AgentId, AgentRuntime>;
}

beforeEach(() => {
  useOffice.setState({ agents: freshAgents(), celebrating: false, cameraPreset: 'overview' });
});

describe('roster 6 agen', () => {
  it('punya 6 agen dengan home di atas pad zona PRD §4.1', () => {
    expect(AGENT_ROSTER).toHaveLength(6);
    expect(new Set(AGENT_ROSTER.map((a) => a.id)).size).toBe(6);
    for (const agent of AGENT_ROSTER) {
      expect(agent.home[1]).toBeCloseTo(0.4); // permukaan pad zona
      expect(agent.name.length).toBeGreaterThan(0);
      expect(agent.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('semua agen mulai IDLE', () => {
    const { agents } = useOffice.getState();
    for (const entry of AGENT_ROSTER) {
      expect(agents[entry.id].state).toBe('IDLE');
    }
  });
});

describe('state matrix (PRD §4.2)', () => {
  it('setState mengubah state + menyimpan log bertimestamp', () => {
    const before = Date.now();
    useOffice.getState().setState('dev_agent', 'WORKING', 'Emitting src/routes');
    const runtime = useOffice.getState().agents.dev_agent;
    expect(runtime.state).toBe('WORKING');
    expect(runtime.log).toBe('Emitting src/routes');
    expect(runtime.logAt).toBeGreaterThanOrEqual(before);
  });

  it('walkTo menyiapkan WALKING + tujuan + state pending', () => {
    useOffice.getState().walkTo('pm_agent', [0, 0.4, 0], 'CELEBRATE');
    const runtime = useOffice.getState().agents.pm_agent;
    expect(runtime.state).toBe('WALKING');
    expect(runtime.target).toEqual([0, 0.4, 0]);
    expect(runtime.pending).toBe('CELEBRATE');
  });

  it('arrive menukar state pending → state final & membersihkan tujuan', () => {
    useOffice.getState().walkTo('qa_agent', [3, 0.4, 3]); // pending default IDLE
    useOffice.getState().arrive('qa_agent');
    const runtime = useOffice.getState().agents.qa_agent;
    expect(runtime.state).toBe('IDLE');
    expect(runtime.target).toBeUndefined();
    expect(runtime.pending).toBeUndefined();
  });

  it('arrive menyalakan flag celebrating bila pending = CELEBRATE', () => {
    useOffice.getState().walkTo('devops_agent', [1, 0.4, 1], 'CELEBRATE');
    expect(useOffice.getState().celebrating).toBe(false); // belum tiba
    useOffice.getState().arrive('devops_agent');
    expect(useOffice.getState().agents.devops_agent.state).toBe('CELEBRATE');
    expect(useOffice.getState().celebrating).toBe(true);
  });
});

describe('celebration + reset', () => {
  it('celebrationSpot berada di lingkaran radius 3.4 di atas pad hub', () => {
    for (let i = 0; i < AGENT_ROSTER.length; i += 1) {
      const [x, y, z] = celebrationSpot(i);
      expect(Math.hypot(x, z)).toBeCloseTo(3.4, 1);
      expect(y).toBe(0.4);
    }
  });

  it('celebrateAll: semua agen berjalan ke hub_00 dengan pending CELEBRATE', () => {
    useOffice.getState().celebrateAll();
    const { agents } = useOffice.getState();
    AGENT_ROSTER.forEach((entry, index) => {
      const runtime = agents[entry.id];
      expect(runtime.state).toBe('WALKING');
      expect(runtime.pending).toBe('CELEBRATE');
      expect(runtime.target).toEqual(celebrationSpot(index));
    });
    expect(useOffice.getState().celebrating).toBe(false); // menunggu tiba
  });

  it('resetHome: semua berjalan pulang dan flag celebrating turun', () => {
    useOffice.getState().celebrateAll();
    for (const entry of AGENT_ROSTER) useOffice.getState().arrive(entry.id);
    expect(useOffice.getState().celebrating).toBe(true);

    useOffice.getState().resetHome();
    const { agents, celebrating } = useOffice.getState();
    expect(celebrating).toBe(false);
    for (const entry of AGENT_ROSTER) {
      const runtime = agents[entry.id];
      expect(runtime.state).toBe('WALKING');
      expect(runtime.pending).toBe('IDLE');
      expect(runtime.target).toEqual(entry.home);
    }
  });
});

describe('preset kamera', () => {
  it('setCameraPreset menyimpan preset aktif', () => {
    expect(useOffice.getState().cameraPreset).toBe('overview');
    useOffice.getState().setCameraPreset('devLab');
    expect(useOffice.getState().cameraPreset).toBe('devLab');
    useOffice.getState().setCameraPreset('orbit');
    expect(useOffice.getState().cameraPreset).toBe('orbit');
  });
});

describe('beban: 5 agen walking simultan (AC kartu Performance)', () => {
  it('state tetap terisolasi per agen saat 5 berjalan bersamaan', () => {
    const walkers = AGENT_ROSTER.slice(0, 5); // 5 dari 6 agen
    walkers.forEach((entry, i) => {
      useOffice.getState().walkTo(entry.id, [i, 0.4, -i], i % 2 === 0 ? 'CELEBRATE' : 'IDLE');
    });

    // Agen ke-6 tidak ikut berjalan
    const spectator = AGENT_ROSTER[5];
    if (!spectator) throw new Error('roster harus punya 6 agen');
    expect(useOffice.getState().agents[spectator.id].state).toBe('IDLE');

    // Tiba dalam urutan acak — tidak boleh saling menimpa
    const shuffled = [...walkers].reverse();
    shuffled.forEach((entry, i) => {
      const idx = walkers.indexOf(entry);
      useOffice.getState().arrive(entry.id);
      const runtime = useOffice.getState().agents[entry.id];
      expect(runtime.state).toBe(idx % 2 === 0 ? 'CELEBRATE' : 'IDLE');
      expect(runtime.target).toBeUndefined();

      // Agen yang belum tiba masih WALKING (state tidak tercampur)
      const notArrived = shuffled.slice(i + 1);
      for (const pending of notArrived) {
        expect(useOffice.getState().agents[pending.id].state).toBe('WALKING');
      }
    });

    expect(useOffice.getState().celebrating).toBe(true);
  });

  it('semua agen bisa berjalan pulang serentak tanpa residu state', () => {
    for (const entry of AGENT_ROSTER) {
      useOffice.getState().walkTo(entry.id, [0, 0.4, 0], 'CELEBRATE');
    }
    for (const entry of AGENT_ROSTER) useOffice.getState().arrive(entry.id);
    useOffice.getState().resetHome();
    for (const entry of AGENT_ROSTER) useOffice.getState().arrive(entry.id);

    const { agents } = useOffice.getState();
    for (const entry of AGENT_ROSTER) {
      expect(agents[entry.id].state).toBe('IDLE');
      expect(agents[entry.id].target).toBeUndefined();
      expect(agents[entry.id].pending).toBeUndefined();
    }
    expect(useOffice.getState().celebrating).toBe(false);
  });
});
