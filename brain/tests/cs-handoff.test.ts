import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { LeadsStore } from '../src/cs/leads';
import { initialState, type RunState } from '../src/graph/state';
import { makeOrchestrator, FakeSandbox } from './helpers';

/**
 * Handoff Marketer → CS Inbox (Fase 11, PRD §3.4 → §3.5): node Growth menulis
 * peminat yang terdeteksi ke leads store bersama + memancarkan `lead:update`.
 * Id deterministik per run → resume run tidak menduplikasi lead.
 */

function init(runId = 'run_handoff_1'): RunState {
  return initialState({
    runId,
    founderPrompt: 'Micro-SaaS invoice generator with Stripe integration',
    projectName: 'Invoice Generator',
    maxIterations: 2,
    model: 'deterministic-stub-v1',
  });
}

describe('Handoff Marketer → CS Inbox (Fase 11)', () => {
  it('run menulis 2 lead deterministik + emit lead:update ke bus', async () => {
    const leads = new LeadsStore(new Database(':memory:'));
    const { app, bus } = makeOrchestrator({ sandbox: new FakeSandbox('pass'), leads });
    const state = (await app.invoke(init(), { recursionLimit: 64 })) as RunState;

    expect(state.stage).toBe('done');
    const stored = leads.listLeads();
    expect(stored.map((l) => l.id).sort()).toEqual([
      'lead_run_handoff_1_1',
      'lead_run_handoff_1_2',
    ]);
    expect(stored.map((l) => l.source).sort()).toEqual(['email', 'widget']);
    for (const lead of stored) {
      expect(lead.status).toBe('new');
      expect(lead.interest).toContain('Kampanye:');
      expect(lead.nextFollowupAt).not.toBeNull();
      expect(lead.conversationId).toMatch(/^cs:(widget|email):/);
    }

    expect(bus.leadUpdates).toHaveLength(2);
    expect(bus.leadUpdates.every((u) => u.reason === 'created')).toBe(true);
    expect(bus.history.some((p) => p.logMessage.includes('LEADS HANDOFF · 2 peminat'))).toBe(true);
  }, 30_000);

  it('run id deterministik — invoke ulang tidak menduplikasi lead (resume-safe)', async () => {
    const leads = new LeadsStore(new Database(':memory:'));
    const { app } = makeOrchestrator({ sandbox: new FakeSandbox('pass'), leads });
    await app.invoke(init('run_handoff_2'), { recursionLimit: 64 });
    await app.invoke(init('run_handoff_2'), { recursionLimit: 64 });

    expect(leads.listLeads()).toHaveLength(2);
    expect(leads.getLead('lead_run_handoff_2_1')?.source).toBe('widget');
  }, 60_000);
});
