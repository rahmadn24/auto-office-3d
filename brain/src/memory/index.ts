import type { Config } from '../config';
import { dataPaths } from '../durability/paths';
import { createEmbedder } from './embeddings';
import { InMemoryVectorStore } from './inMemory';
import { LanceDbMemory, lancedbDir } from './lancedb';
import { PineconeMemory } from './pinecone';
import type { MemoryProvider } from './provider';

export * from './provider';
export * from './embeddings';
export * from './lancedb';

export function createMemory(config: Config): MemoryProvider {
  const embedder = createEmbedder({
    openaiApiKey: config.openaiApiKey,
    baseUrl: config.openaiBaseUrl,
    model: config.embeddingModel,
  });

  if (config.memoryDriver === 'pinecone') {
    if (!config.pineconeHost || !config.pineconeApiKey) {
      throw new Error('MEMORY_DRIVER=pinecone but PINECONE_HOST / PINECONE_API_KEY is missing');
    }
    return new PineconeMemory(config.pineconeHost, config.pineconeApiKey, embedder);
  }
  if (config.memoryDriver === 'lancedb') {
    // Durable default (PRD v3.0 §2.1) — data di DATA_DIR, bukan RAM.
    return new LanceDbMemory(lancedbDir(dataPaths(config.dataDir).root), embedder);
  }
  return new InMemoryVectorStore(embedder);
}
