import { describe, expect, it } from 'vitest';

import { formatTokens, TokenBudget, TokenBudgetExceededError } from '../src/telemetry/tokens';

describe('TokenBudget & riwayat pemakaian per divisi (PRD §6.4)', () => {
  it('menyusun breakdown per divisi (PM/Dev/QA)', () => {
    const budget = new TokenBudget(250_000);
    budget.add({ inputTokens: 100, outputTokens: 50 }, 'Product');
    budget.add({ inputTokens: 20, outputTokens: 30 }, 'Engineering');
    budget.add({ inputTokens: 10, outputTokens: 5 }, 'Product');

    expect(budget.byDivision()).toEqual({ Product: 165, Engineering: 50 });
    expect(budget.total).toBe(215);
    expect(budget.remaining).toBe(249_785);
    // Snapshot berupa salinan — perubahan luar tidak mengubah internal.
    const snapshot = budget.byDivision();
    snapshot.Product = 999_999;
    expect(budget.byDivision().Product).toBe(165);
  });

  it('tanpa divisi tetap terhitung di total tanpa menambah entri', () => {
    const budget = new TokenBudget(1_000);
    budget.add({ inputTokens: 7, outputTokens: 3 });
    expect(budget.total).toBe(10);
    expect(budget.byDivision()).toEqual({});
  });

  it('meledak saat bleed (hard-kill) dan menandai exhausted', () => {
    const budget = new TokenBudget(100);
    budget.add({ inputTokens: 60, outputTokens: 30 }, 'Product');
    expect(budget.exhausted).toBe(false);
    expect(budget.usageRatio).toBeCloseTo(0.9);

    expect(() => budget.add({ inputTokens: 10, outputTokens: 5 }, 'Engineering')).toThrow(
      TokenBudgetExceededError,
    );
    expect(budget.exhausted).toBe(true);
    expect(budget.usageRatio).toBeGreaterThan(1);
    expect(budget.byDivision()).toEqual({ Product: 90, Engineering: 15 });
  });

  it('format ala HUD', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(142_800)).toBe('142.8k');
    expect(formatTokens(250_000)).toBe('250.0k');
  });
});
