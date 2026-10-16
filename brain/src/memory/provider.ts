/** Vector memory — PRD §2.1 (4 namespace Pinecone) & Milestone #3 (cosine > 0.85). */

export const MEMORY_NAMESPACES = ['pm-memory', 'dev-memory', 'qa-memory', 'marketing-mem'] as const;
export type MemoryNamespace = (typeof MEMORY_NAMESPACES)[number];

/** Ambang minimum relevansi ingatan lintas run (Milestone #3). */
export const SIMILARITY_THRESHOLD = 0.85;

export interface MemoryRecord {
  id: string;
  text: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface MemoryHit extends MemoryRecord {
  score: number;
  namespace: MemoryNamespace;
}

export interface MemoryProvider {
  readonly driver: string;
  upsert(namespace: MemoryNamespace, records: MemoryRecord[]): Promise<void>;
  search(namespace: MemoryNamespace, query: string, topK?: number): Promise<MemoryHit[]>;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
