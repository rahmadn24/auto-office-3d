/** Embedding providers — production: OpenAI text-embedding-3-small, offline: deterministic hash. */

export interface Embedder {
  readonly model: string;
  readonly driver: string;
  embed(texts: string[]): Promise<number[][]>;
}

const DIMENSION = 512;

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic bag-of-tokens(+bigram) embedding.
 * Dipakai ketika OPENAI_API_KEY kosong: teks identik → cosine 1.0,
 * teks makin mirip → makin mendekati 1 (cukup untuk uji recall RAG offline).
 */
export class HashEmbedder implements Embedder {
  readonly driver = 'hash';
  readonly model = 'hash-bag-of-tokens-512';

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const vec = new Array<number>(DIMENSION).fill(0);
      const tokens = t
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);

      for (const tok of tokens) {
        vec[fnv1a(tok) % DIMENSION] = (vec[fnv1a(tok) % DIMENSION] ?? 0) + 1;
      }
      for (let i = 0; i < tokens.length - 1; i++) {
        const bi = `${tokens[i]}_${tokens[i + 1]}`;
        vec[fnv1a(bi) % DIMENSION] = (vec[fnv1a(bi) % DIMENSION] ?? 0) + 2;
      }

      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] = (vec[i] ?? 0) / norm;
      return vec;
    });
  }
}

/** Production: POST {baseUrl}/embeddings (default OpenAI; bisa diarahkan ke gateway lokal). */
export class OpenAIEmbedder implements Embedder {
  readonly driver = 'openai';

  constructor(
    private readonly apiKey: string,
    readonly model: string = 'text-embedding-3-small',
    private readonly baseUrl: string = 'https://api.openai.com/v1',
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenAI embeddings failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
    return json.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}

export function createEmbedder(opts: {
  openaiApiKey?: string;
  baseUrl?: string;
  model: string;
}): Embedder {
  return opts.openaiApiKey
    ? new OpenAIEmbedder(opts.openaiApiKey, opts.model, opts.baseUrl)
    : new HashEmbedder();
}
