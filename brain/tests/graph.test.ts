import { describe, expect, it } from 'vitest';

import { initialState, type RunState } from '../src/graph/state';
import { EventBus } from '../src/events';
import { ZONE_COORDINATES, AGENT_IDS, ACTIONS, DIVISIONS, ZONES } from '../src/types';
import { makeOrchestrator, FakeSandbox } from './helpers';

function prompt(): string {
  return 'Micro-SaaS invoice generator with Stripe integration';
}

function init(maxIterations = 5) {
  return initialState({
    runId: 'run_test_1',
    founderPrompt: prompt(),
    projectName: 'Invoice Generator',
    maxIterations,
    model: 'deterministic-stub-v1',
  });
}

function assertContract(bus: EventBus): void {
  for (const p of bus.history) {
    expect(AGENT_IDS).toContain(p.agentId);
    expect(DIVISIONS).toContain(p.division);
    expect(ACTIONS).toContain(p.currentAction);
    expect(ZONES).toContain(p.targetZone);
    expect(p.runId).toBe('run_test_1');
    expect(p.logMessage.length).toBeGreaterThan(0);
    expect(p.telemetry.model.length).toBeGreaterThan(0);
    expect(typeof p.telemetry.tokensUsed).toBe('number');
    expect(p.coordinates).toEqual(ZONE_COORDINATES[p.targetZone]);
    if (p.iterationCycle) {
      expect(p.iterationCycle.max).toBe(5);
      expect(p.iterationCycle.current).toBeLessThanOrEqual(5);
    }
  }
}

describe('LangGraph orchestrator (PRD §3)', () => {
  it('happy path: PRD → kode → QA hijau → deploy → sale pertama', async () => {
    const { app, bus } = makeOrchestrator({ sandbox: new FakeSandbox('pass') });
    const state = (await app.invoke(init(), { recursionLimit: 64 })) as RunState;

    expect(state.stage).toBe('done');
    expect(state.iteration).toBe(1);
    expect(state.qaPassed).toBe(true);
    expect(state.fallbackTriggered).toBe(false);
    expect(state.hasCustomers).toBe(true);
    expect(state.healthOk).toBe(true);
    expect(state.liveUrl).toMatch(/\.vercel\.app$/);
    expect(state.repoUrl).toContain('github.com');
    expect(state.prd).toContain('## 01 / Executive Summary');
    expect(Object.keys(state.artifacts).some((k) => k.startsWith('specs/PRD-'))).toBe(true);
    expect(Object.keys(state.artifacts)).toContain('tests/engine.spec.ts');

    const agents = new Set(bus.history.map((p) => p.agentId));
    for (const id of AGENT_IDS) expect(agents.has(id)).toBe(true);

    expect(bus.milestones).toHaveLength(1);
    expect(bus.milestones[0]?.amount).toBe(29);
    expect(bus.milestones[0]?.hasCustomers).toBe(true);

    assertContract(bus);
  }, 30_000);

  it('QA selalu gagal → circuit breaker di siklus ke-5 → fallback safe-build', async () => {
    const { app, bus } = makeOrchestrator({ sandbox: new FakeSandbox('fail-then-safe') });
    const state = (await app.invoke(init(5), { recursionLimit: 64 })) as RunState;

    expect(state.iteration).toBe(5);
    expect(state.fallbackTriggered).toBe(true);
    // Fallback tidak membatalkan run: safe-build tetap dideploy sampai stage 'done'
    expect(state.stage).toBe('done');
    expect(state.lastQaSummary).toContain('Safe-build verified');
    // Run tetap menghasilkan artefak yang bisa dideploy meski loop QA gagal
    expect(state.liveUrl).toMatch(/\.vercel\.app$/);
    expect(state.hasCustomers).toBe(true);

    const cycles = bus.history
      .filter((p) => p.agentId === 'qa_agent')
      .map((p) => p.iterationCycle?.current)
      .filter((n): n is number => typeof n === 'number');
    expect(Math.max(...cycles)).toBe(5);
    expect(bus.history.some((p) => p.logMessage.includes('CIRCUIT BREAKER TRIPPED'))).toBe(true);

    assertContract(bus);
  }, 30_000);

  it('jalur penuh dengan sandbox lokal nyata (tsc + vitest di temp terisolasi)', async () => {
    const { app, bus } = makeOrchestrator();
    const state = (await app.invoke(init(), { recursionLimit: 64 })) as RunState;

    expect(state.stage).toBe('done');
    expect(state.qaPassed).toBe(true);
    expect(state.iteration).toBe(1);
    expect(state.lastQaSummary).toMatch(/Passed \d+\/\d+ tests · tsc clean/);
    expect(state.hasCustomers).toBe(true);
    expect(state.tokensUsed).toBeGreaterThan(0);
    assertContract(bus);
  }, 120_000);
});
