import { describe, expect, it } from 'vitest';

import {
  parseAgentStatus,
  parseFirstSale,
  type AgentStatusPayload,
  type FirstSalePayload,
} from '../lib/events';

// Fixture ini sengaja identik dengan brain/tests/contract.test.ts — paritas
// duplikasi terkontrol kedua sisi kontrak (PRD §2: tanpa import silang).
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

describe('kontrak client (duplikasi lib/events.ts)', () => {
  it('payload valid diterima', () => {
    expect(parseAgentStatus(validStatus).ok).toBe(true);
    expect(parseFirstSale(validSale).ok).toBe(true);
  });

  it('agentId / currentAction / targetZone di luar daftar ditolak', () => {
    expect(parseAgentStatus({ ...validStatus, agentId: 'bot' }).ok).toBe(false);
    expect(parseAgentStatus({ ...validStatus, currentAction: 'dancing' }).ok).toBe(false);
    expect(parseAgentStatus({ ...validStatus, targetZone: 'void' }).ok).toBe(false);
  });

  it('payload tidak valid tidak throw (ditolak + issues)', () => {
    const r = parseAgentStatus({ garbage: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
    expect(parseFirstSale(null).ok).toBe(false);
    expect(parseFirstSale({ ...validSale, currency: 'EUR' }).ok).toBe(false);
    expect(parseFirstSale({ ...validSale, hasCustomers: false }).ok).toBe(false);
  });

  it('telemetry wajib & non-negatif', () => {
    const { telemetry: _t, ...without } = validStatus;
    expect(parseAgentStatus(without).ok).toBe(false);
    expect(
      parseAgentStatus({ ...validStatus, telemetry: { ...validStatus.telemetry, tokensUsed: -1 } })
        .ok,
    ).toBe(false);
  });
});
