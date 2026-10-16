import type { Config } from '../config';
import { createEmbedder } from './embeddings';
import { InMemoryVectorStore } from './inMemory';
import { PineconeMemory } from './pinecone';
import type { MemoryProvider } from './provider';

export * from './provider';
export * from './embeddings';

export function createMemory(config: Config): MemoryProvider {
  const embedder = createEmbedder({
    openaiApiKey: config.openaiApiKey,
    model: config.embeddingModel,
  });

  if (config.memoryDriver === 'pinecone') {
    if (!config.pineconeHost || !config.pineconeApiKey) {
      throw new Error('MEMORY_DRIVER=pinecone but PINECONE_HOST / PINECONE_API_KEY is missing');
    }
    return new PineconeMemory(config.pineconeHost, config.pineconeApiKey, embedder);
  }
  return new InMemoryVectorStore(embedder);
}
