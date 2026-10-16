import type { Embedder } from './embeddings';
import type { MemoryHit, MemoryNamespace, MemoryProvider, MemoryRecord } from './provider';

/**
 * Pinecone Serverless via REST (tanpa SDK berat).
 * Butuh PINECONE_HOST (mis. https://idx-xxx-prod.svc.aped.pinecone.io) + PINECONE_API_KEY.
 * Namespace dipisahkan per divisi sesuai PRD §2.1.
 */
export class PineconeMemory implements MemoryProvider {
  readonly driver = 'pinecone';

  constructor(
    private readonly host: string,
    private readonly apiKey: string,
    private readonly embedder: Embedder,
  ) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      apikey: this.apiKey,
      'x-pinecone-api-version': '2025-04',
    };
  }

  async upsert(namespace: MemoryNamespace, records: MemoryRecord[]): Promise<void> {
    if (records.length === 0) return;
    const vectors = await this.embedder.embed(records.map((r) => r.text));
    const body = {
      namespace,
      vectors: records.map((r, i) => ({
        id: r.id,
        values: vectors[i] ?? [],
        metadata: { text: r.text, ...(r.metadata ?? {}) },
      })),
    };
    const res = await fetch(`${this.host}/vectors/upsert`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Pinecone upsert failed (${res.status}): ${await res.text()}`);
  }

  async search(namespace: MemoryNamespace, query: string, topK = 3): Promise<MemoryHit[]> {
    const [vector] = await this.embedder.embed([query]);
    const res = await fetch(`${this.host}/query`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        namespace,
        vector: vector ?? [],
        topK,
        includeMetadata: true,
      }),
    });
    if (!res.ok) throw new Error(`Pinecone query failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as {
      matches?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>;
    };
    return (json.matches ?? []).map((m) => {
      const meta = m.metadata ?? {};
      const { text, ...rest } = meta;
      return {
        id: m.id,
        score: m.score,
        namespace,
        text: typeof text === 'string' ? text : '',
        metadata: rest as MemoryRecord['metadata'],
      };
    });
  }
}
