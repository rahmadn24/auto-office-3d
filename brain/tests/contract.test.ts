import { describe, expect, it } from 'vitest';

import { EventBus } from '../src/events';
import { parseAgentStatus, parseFirstSale } from '../src/server/contract';
import type { AgentStatusPayload, FirstSalePayload } from '../src/types';

const validStatus: AgentStatusPayload = {
  runId: 'run_x',
  agentId: 'dev_agent',
  division: 'Engineering',
  currentAction: 'coding',
  targetZone: 'dev_lab',
  coordinates: { x: 14, y: 0.4, z: -12 },
  logMessage: 'Emitting routes',
  iterationCycle: { current: 1, max: 5 },
  telemetry: { tokensUsed: 1200, latencyMs: 240, model: 'stub' },
  timestamp: '12:00:00.000',
};

const validSale: FirstSalePayload = {
  runId: 'run_x',
  customer: { city: 'San Francisco', country: 'US', maskedEmail: 'a***@x.io' },
  amount: 29,
  currency: 'USD',
  stripeEventId: 'evt_1',
  hasCustomers: true,
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('kontrak agent:status_update (PRD §5.1)', () => {
  it('payload valid lolos validasi Zod', () => {
    const r = parseAgentStatus(validStatus);
    expect(r.ok).toBe(true);
  });

  it('agentId di luar daftar ditolak', () => {
    const r = parseAgentStatus({ ...validStatus, agentId: 'hacker_agent' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toMatch(/agentId/);
  });

  it('currentAction di luar daftar ditolak', () => {
    const r = parseAgentStatus({ ...validStatus, currentAction: 'dancing' });
    expect(r.ok).toBe(false);
  });

  it('telemetry hilang / negatif ditolak', () => {
    const { telemetry: _t, ...without } = validStatus;
    expect(parseAgentStatus(without).ok).toBe(false);
    expect(
      parseAgentStatus({ ...validStatus, telemetry: { ...validStatus.telemetry, latencyMs: -1 } })
        .ok,
    ).toBe(false);
  });

  it('bukan objek (null/string) ditolak tanpa throw', () => {
    expect(parseAgentStatus(null).ok).toBe(false);
    expect(parseAgentStatus('boom').ok).toBe(false);
  });
});

describe('kontrak milestone:first_sale (PRD §5.2)', () => {
  it('payload valid lolos', () => {
    expect(parseFirstSale(validSale).ok).toBe(true);
  });

  it('currency bukan USD ditolak', () => {
    expect(parseFirstSale({ ...validSale, currency: 'EUR' }).ok).toBe(false);
  });

  it('hasCustomers bukan literal true ditolak', () => {
    expect(parseFirstSale({ ...validSale, hasCustomers: false }).ok).toBe(false);
  });

  it('amount nol/negatif ditolak', () => {
    expect(parseFirstSale({ ...validSale, amount: 0 }).ok).toBe(false);
    expect(parseFirstSale({ ...validSale, amount: -5 }).ok).toBe(false);
  });
});

describe('EventBus menyimpan history untuk snapshot', () => {
  it('agent & milestone tercatat', () => {
    const bus = new EventBus();
    bus.agent(validStatus);
    bus.milestone(validSale);
    expect(bus.history).toHaveLength(1);
    expect(bus.milestones).toHaveLength(1);
  });
});
