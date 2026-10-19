import { describe, expect, it } from 'vitest';

import { estimateCostUsd, formatCostUsd, pricingFor } from '../src/llm/pricing';

describe('pricing: estimasi biaya per model dari tabel benchmark (Fase 13)', () => {
  it('cocok exact & prefix provider (tokenomix/deepseek-…)', () => {
    expect(pricingFor('gpt-4o-mini')?.inputPerMTok).toBe(0.15);
    expect(pricingFor('tokenomix/deepseek-v4.1-flash')?.label).toBe('DeepSeek 4.1 Flash');
    expect(pricingFor('claude-3-5-sonnet-latest')?.outputPerMTok).toBe(15);
    expect(pricingFor('model-asing-tanpa-harga')).toBeNull();
  });

  it('estimasi biaya = harga input + output per 1M token', () => {
    const cost = estimateCostUsd('gpt-4o-mini', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.75, 6);
    const sonnet = estimateCostUsd('claude-3-5-sonnet-latest', {
      inputTokens: 500_000,
      outputTokens: 100_000,
    });
    expect(sonnet).toBeCloseTo(3.0, 6);
    expect(estimateCostUsd('tidak-dikenal', { inputTokens: 1, outputTokens: 1 })).toBeNull();
  });

  it('format biaya ringkas: 4 desimal, <$0.0001 untuk sangat kecil, n/a tanpa harga', () => {
    expect(formatCostUsd(0.0123)).toBe('$0.0123');
    expect(formatCostUsd(0.00001)).toBe('<$0.0001');
    expect(formatCostUsd(null)).toBe('n/a');
  });
});
