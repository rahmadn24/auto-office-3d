import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentStatusPayload, FirstSalePayload } from '../lib/events';
import {
  actionToAnimState,
  parseBrainTimestamp,
  useBrain,
  zoneActivitySuffix,
} from '../store/brainStore';

function status(over: Partial<AgentStatusPayload> = {}): AgentStatusPayload {
  return {
    runId: 'run_1',
    agentId: 'dev_agent',
    division: 'Engineering',
    currentAction: 'coding',
    targetZone: 'dev_lab',
    coordinates: { x: 14, y: 0.4, z: -12 },
    logMessage: 'Emitting routes',
    telemetry: { tokensUsed: 1200, latencyMs: 200, model: 'stub' },
    timestamp: '12:00:00.000',
    ...over,
  };
}

function sale(over: Partial<FirstSalePayload> = {}): FirstSalePayload {
  return {
    runId: 'run_1',
    customer: { city: 'San Francisco', country: 'US', maskedEmail: 'a***@x.io' },
    amount: 29,
    currency: 'USD',
    stripeEventId: 'evt_1',
    hasCustomers: true,
    timestamp: '12:00:00.000',
    ...over,
  };
}

beforeEach(() => {
  useBrain.setState({
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
  });
});

describe('brainStore: applyStatus (diff update)', () => {
  it('menyimpan agent by id + menurunkan runStage + tokens', () => {
    const ok = useBrain.getState().applyStatus(status());
    expect(ok).toBe(true);
    const s = useBrain.getState();
    expect(s.agents.dev_agent?.currentAction).toBe('coding');
    expect(s.runStage).toBe('CODING');
    expect(s.tokens).toBe(1200);
    expect(s.eventCount).toBe(1);
    expect(s.feed).toHaveLength(1);
  });

  it('payload lebih lama diabaikan (diff, bukan replace penuh)', () => {
    useBrain.getState().applyStatus(status({ timestamp: '12:00:05.000' }));
    const older = useBrain.getState().applyStatus(status({ timestamp: '12:00:01.000' }));
    expect(older).toBe(false);
    expect(useBrain.getState().agents.dev_agent?.timestamp).toBe('12:00:05.000');
    expect(useBrain.getState().eventCount).toBe(1);
  });

  it('beberapa agen tersimpan terpisah', () => {
    useBrain.getState().applyStatus(status());
    useBrain.getState().applyStatus(status({ agentId: 'qa_agent', division: 'QA' }));
    expect(Object.keys(useBrain.getState().agents)).toEqual(
      expect.arrayContaining(['dev_agent', 'qa_agent']),
    );
  });
});

describe('brainStore: applyMilestone (idempoten)', () => {
  it('milestone pertama menyalakan hasCustomers + feed', () => {
    expect(useBrain.getState().applyMilestone(sale())).toBe(true);
    const s = useBrain.getState();
    expect(s.hasCustomers).toBe(true);
    expect(s.milestone?.stripeEventId).toBe('evt_1');
    expect(s.runStage).toBe('DONE');
    expect(s.feed[0]?.kind).toBe('milestone');
  });

  it('stripeEventId sama tidak memicu celebration kedua', () => {
    useBrain.getState().applyMilestone(sale());
    const dup = useBrain.getState().applyMilestone(sale());
    expect(dup).toBe(false);
    expect(useBrain.getState().feed.filter((f) => f.kind === 'milestone')).toHaveLength(1);
  });
});

describe('brainStore: snapshot hydrate', () => {
  it('mengisi agents & milestone dari snapshot', () => {
    useBrain.getState().hydrateSnapshot({ agents: [status()], milestones: [sale()] });
    const s = useBrain.getState();
    expect(s.agents.dev_agent?.agentId).toBe('dev_agent');
    expect(s.hasCustomers).toBe(true);
  });

  it('snapshot tidak menurunkan state yang lebih baru', () => {
    useBrain.getState().applyStatus(status({ timestamp: '12:05:00.000' }));
    useBrain.getState().hydrateSnapshot({ agents: [status({ timestamp: '12:00:00.000' })] });
    expect(useBrain.getState().agents.dev_agent?.timestamp).toBe('12:05:00.000');
  });
});

describe('helper: mapping aksi & zona', () => {
  it('actionToAnimState memetakan sesuai PRD §4.2', () => {
    expect(actionToAnimState('idle')).toBe('IDLE');
    expect(actionToAnimState('walking')).toBe('WALKING');
    expect(actionToAnimState('celebrating')).toBe('CELEBRATE');
    expect(actionToAnimState('coding')).toBe('WORKING');
    expect(actionToAnimState('testing')).toBe('WORKING');
  });

  it('zoneActivitySuffix menyalakan label saat aksi aktif & segar', () => {
    const fresh = status({
      agentId: 'pm_agent',
      division: 'Product',
      currentAction: 'discussing',
      targetZone: 'meeting_room',
      timestamp: parseBrainTimestampToLabel(Date.now()),
    });
    useBrain.setState({ agents: { pm_agent: fresh } });
    const suffix = zoneActivitySuffix('meeting_room', useBrain.getState().agents, Date.now());
    expect(suffix).toBe('ACTIVE DEBATE');
  });

  it('status basi (>5s) tidak menyalakan label', () => {
    const stale = status({
      currentAction: 'coding',
      targetZone: 'dev_lab',
      timestamp: '00:00:00.000',
    });
    const suffix = zoneActivitySuffix('dev_lab', { dev_agent: stale }, Date.now() + 60_000);
    expect(suffix).toBeNull();
  });
});

/** Bangun label timestamp HH:MM:SS.mmm untuk waktu epoch tertentu. */
function parseBrainTimestampToLabel(epoch: number): string {
  const d = new Date(epoch);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
