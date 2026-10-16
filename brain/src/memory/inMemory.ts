import type { Embedder } from './embeddings';
import {
  SIMILARITY_THRESHOLD,
  type MemoryHit,
  type MemoryNamespace,
  type MemoryProvider,
  type MemoryRecord,
  cosineSimilarity,
} from './provider';

interface Entry {
  record: MemoryRecord;
  vector: number[];
}

/** Vector store in-process — driver offline & untuk test. Perilaku serupa Pinecone per-namespace. */
export class InMemoryVectorStore implements MemoryProvider {
  readonly driver = 'memory';
  private readonly namespaces = new Map<MemoryNamespace, Map<string, Entry>>();

  constructor(private readonly embedder: Embedder) {}

  async upsert(namespace: MemoryNamespace, records: MemoryRecord[]): Promise<void> {
    if (records.length === 0) return;
    const vectors = await this.embedder.embed(records.map((r) => r.text));
    let bucket = this.namespaces.get(namespace);
    if (!bucket) {
      bucket = new Map();
      this.namespaces.set(namespace, bucket);
    }
    records.forEach((record, i) => {
      bucket!.set(record.id, { record, vector: vectors[i] ?? [] });
    });
  }

  async search(namespace: MemoryNamespace, query: string, topK = 3): Promise<MemoryHit[]> {
    const bucket = this.namespaces.get(namespace);
    if (!bucket || bucket.size === 0) return [];
    const [q] = await this.embedder.embed([query]);
    const scored: MemoryHit[] = [];
    for (const entry of bucket.values()) {
      scored.push({
        ...entry.record,
        namespace,
        score: cosineSimilarity(q ?? [], entry.vector),
      });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /** Uji silang: pastikan ingatan tidak bocor antar namespace. */
  async count(namespace: MemoryNamespace): Promise<number> {
    return this.namespaces.get(namespace)?.size ?? 0;
  }

  static readonly threshold = SIMILARITY_THRESHOLD;
}
