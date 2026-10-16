import { describe, expect, it } from 'vitest';

import { HashEmbedder } from '../src/memory/embeddings';
import { InMemoryVectorStore } from '../src/memory/inMemory';
import { SIMILARITY_THRESHOLD, cosineSimilarity } from '../src/memory/provider';
import { seedMemory } from '../src/run';

function store(): InMemoryVectorStore {
  return new InMemoryVectorStore(new HashEmbedder());
}

describe('vector memory (PRD §2.1 · Milestone #3)', () => {
  it('cosine identik = 1, orthogonal = 0', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('recall lintas run melampaui ambang 0.85', async () => {
    const memory = store();
    await memory.upsert('pm-memory', [
      {
        id: 'a',
        text: 'Stripe webhook idempotent handler using Supabase RPC billing_cycle_decrement',
      },
    ]);
    const [hit] = await memory.search(
      'pm-memory',
      'Stripe webhook idempotent handler using Supabase RPC billing_cycle_decrement',
    );
    expect(hit).toBeDefined();
    expect(hit?.score).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it('namespace terisolasi — memori dev tidak bocor ke qa', async () => {
    const memory = store();
    await memory.upsert('dev-memory', [
      { id: 'd1', text: 'Next.js App Router Stripe checkout boilerplate' },
    ]);
    const cross = await memory.search(
      'qa-memory',
      'Next.js App Router Stripe checkout boilerplate',
    );
    expect(cross).toHaveLength(0);
    expect(await memory.count('dev-memory')).toBe(1);
    expect(await memory.count('qa-memory')).toBe(0);
  });

  it('seedMemory mengisi keempat namespace sesuai PRD', async () => {
    const memory = store();
    await seedMemory(memory);
    for (const ns of ['pm-memory', 'dev-memory', 'qa-memory', 'marketing-mem'] as const) {
      expect(await memory.count(ns)).toBeGreaterThan(0);
    }
  });
});
