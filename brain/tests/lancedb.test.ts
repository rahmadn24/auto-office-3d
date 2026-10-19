import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { HashEmbedder } from '../src/memory/embeddings';
import { LanceDbMemory } from '../src/memory/lancedb';

const dir = mkdtempSync(join(tmpdir(), 'ao3d-lance-'));
const lancedbPath = join(dir, 'lancedb');

describe('LanceDbMemory — driver durable default (PRD v3.0 §2.1)', () => {
  it('upsert → search cosine dengan metadata utuh', async () => {
    const mem = new LanceDbMemory(lancedbPath, new HashEmbedder());
    await mem.upsert('pm-memory', [
      {
        id: 'a',
        text: 'Stripe webhook idempotent handler with billing cycle decrement',
        metadata: { kind: 'architecture' },
      },
      { id: 'b', text: 'Marketing hook: plain client chats to invoices in three seconds' },
    ]);

    const hits = await mem.search('pm-memory', 'stripe webhook idempotent handler', 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.id).toBe('a');
    expect(hits[0]!.score).toBeGreaterThan(0.5);
    expect(hits[0]!.score).toBeLessThanOrEqual(1);
    expect(hits[0]!.metadata).toEqual({ kind: 'architecture' });
    expect(hits[0]!.namespace).toBe('pm-memory');
  });

  it('restart daemon (instance baru, folder sama) → ingatan tetap ada', async () => {
    const again = new LanceDbMemory(lancedbPath, new HashEmbedder());
    const hits = await again.search('pm-memory', 'stripe webhook idempotent', 1);
    expect(hits[0]?.id).toBe('a');
  });

  it('upsert id yang sama → update, bukan duplikat', async () => {
    const mem = new LanceDbMemory(lancedbPath, new HashEmbedder());
    await mem.upsert('pm-memory', [{ id: 'a', text: 'diperbarui total menjadi versi baru' }]);

    const sizes = await mem.sizes();
    expect(sizes['pm-memory']).toBe(2);

    const hits = await mem.search('pm-memory', 'diperbarui total', 1);
    expect(hits[0]!.text).toBe('diperbarui total menjadi versi baru');
  });

  it('namespace terisolasi satu sama lain', async () => {
    const mem = new LanceDbMemory(lancedbPath, new HashEmbedder());
    await mem.upsert('qa-memory', [{ id: 'q1', text: 'edge case VAT reverse charge EU' }]);

    const pm = await mem.search('pm-memory', 'edge case VAT reverse charge EU', 3);
    expect(pm.every((h) => h.namespace === 'pm-memory')).toBe(true);

    const sizes = await mem.sizes();
    expect(sizes['qa-memory']).toBe(1);
    expect(sizes['pm-memory']).toBe(2);
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
