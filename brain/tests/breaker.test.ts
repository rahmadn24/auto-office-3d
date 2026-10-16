import { describe, expect, it } from 'vitest';

import { breakerStatus, cycleLabel, decideBreaker } from '../src/graph/breaker';
import { TokenBudget, TokenBudgetExceededError, formatTokens } from '../src/telemetry/tokens';

describe('circuit breaker guardrail (PRD §3.2)', () => {
  it('QA hijau → deploy tanpa iterasi tambahan', () => {
    expect(decideBreaker({ qaPassed: true, iteration: 1, maxIterations: 5 })).toBe('deploy');
  });

  it('QA gagal sebelum siklus ke-5 → retry ke Dev Agent', () => {
    for (let i = 1; i < 5; i++) {
      expect(decideBreaker({ qaPassed: false, iteration: i, maxIterations: 5 })).toBe('retry');
    }
  });

  it('siklus ke-5 masih gagal → fallback safe-build (bukan retry)', () => {
    expect(decideBreaker({ qaPassed: false, iteration: 5, maxIterations: 5 })).toBe('fallback');
  });

  it('status breaker untuk HUD: ARMED (n/5)', () => {
    expect(breakerStatus(2, 5)).toMatchObject({ armed: true, label: 'ARMED (2/5)', exhausted: false });
    expect(breakerStatus(5, 5)).toMatchObject({ armed: false, label: 'ARMED (5/5)', exhausted: true });
    expect(cycleLabel(4, 5)).toBe('Cycle 5/5');
  });
});

describe('token bleed protection (PRD §6.4)', () => {
  it('hard-kill ketika melebihi 250.000 token', () => {
    const budget = new TokenBudget(250_000);
    budget.add({ inputTokens: 100_000, outputTokens: 50_000 });
    expect(budget.total).toBe(150_000);
    expect(budget.remaining).toBe(100_000);

    expect(() => budget.add({ inputTokens: 60_000, outputTokens: 45_000 })).toThrow(
      TokenBudgetExceededError,
    );
    expect(budget.exhausted).toBe(true);
  });

    it('format ala HUD', () => {
    expect(formatTokens(142_800)).toBe('142.8k');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1_250_000)).toBe('1250.0k');
  });
});
