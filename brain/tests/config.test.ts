import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';

describe('config & driver resolution', () => {
  it('mode offline: tanpa API key → stub LLM, memory vector, sandbox lokal', () => {
    const config = loadConfig({});
    expect(config.llmDriver).toBe('stub');
    expect(config.memoryDriver).toBe('memory');
    expect(config.sandboxDriver).toBe('local');
    expect(config.maxIterations).toBe(5);
    expect(config.tokenBudget).toBe(250_000);
    expect(config.sandboxTimeoutMs).toBe(60_000);
  });

  it('auto: kredensial lengkap → driver produksi', () => {
    const config = loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-x',
      PINECONE_API_KEY: 'pc-x',
      PINECONE_HOST: 'https://idx.svc.pinecone.io',
      E2B_API_KEY: 'e2b-x',
    });
    expect(config.llmDriver).toBe('anthropic');
    expect(config.memoryDriver).toBe('pinecone');
    expect(config.sandboxDriver).toBe('e2b');
  });

  it('auto: sebagian kredensial → jatuh ke driver aman', () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-x' });
    expect(config.llmDriver).toBe('anthropic');
    expect(config.memoryDriver).toBe('memory');
    expect(config.sandboxDriver).toBe('local');
  });

  it('driver eksplisit menang atas auto', () => {
    const config = loadConfig({ LLM_DRIVER: 'stub', ANTHROPIC_API_KEY: 'sk-ant-x' });
    expect(config.llmDriver).toBe('stub');
  });
});
