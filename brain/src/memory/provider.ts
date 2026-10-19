/** Vector memory — PRD §2.1 (namespace Pinecone) & Milestone #3 (cosine > 0.85). */

export const MEMORY_NAMESPACES = [
  'pm-memory',
  'dev-memory',
  'qa-memory',
  'marketing-mem',
  // Fase 8 — Briefing Room: transkrip diskusi Founder↔PM (durable, selamat restart).
  'briefing',
  // Fase 11 — CS Agent: ingatan interaksi client lintas channel (mini-CRM recall).
  'leads',
] as const;
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

/** Query daftar record kronologis (Briefing Room) — filter metadata + batas jumlah. */
export interface MemoryListQuery {
  /** Cocokkan metadata persis (AND antar key). */
  where?: Record<string, string | number | boolean>;
  /** Batas jumlah record (default 200). */
  limit?: number;
}

export interface MemoryProvider {
  readonly driver: string;
  upsert(namespace: MemoryNamespace, records: MemoryRecord[]): Promise<void>;
  search(namespace: MemoryNamespace, query: string, topK?: number): Promise<MemoryHit[]>;
  /** Jumlah vektor per namespace — untuk inspector Vector DB (Fase 5). */
  sizes(): Promise<Record<string, number>>;
  /**
   * Daftar record satu namespace (opsional) — thread kronologis Briefing Room.
   * Driver tanpa dukungan list (mis. Pinecone) boleh mengabaikannya; service
   * briefing tetap punya cache in-process sebagai fallback.
   */
  list?(namespace: MemoryNamespace, query?: MemoryListQuery): Promise<MemoryRecord[]>;
}

/** Filter metadata bersama untuk implementasi `list` tiap driver. */
export function matchesWhere(
  record: MemoryRecord,
  where?: Record<string, string | number | boolean>,
): boolean {
  if (!where) return true;
  const meta = record.metadata ?? {};
  return Object.entries(where).every(([key, value]) => meta[key] === value);
}

/** Urutkan record berdasarkan `metadata.seq` (naik); tanpa seq → urutan stabil di akhir. */
export function sortBySeq(records: MemoryRecord[]): MemoryRecord[] {
  return [...records].sort((a, b) => {
    const sa = typeof a.metadata?.seq === 'number' ? a.metadata.seq : Number.MAX_SAFE_INTEGER;
    const sb = typeof b.metadata?.seq === 'number' ? b.metadata.seq : Number.MAX_SAFE_INTEGER;
    return sa - sb;
  });
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
