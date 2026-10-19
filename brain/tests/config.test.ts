import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';

describe('config & driver resolution', () => {
  it('mode offline: tanpa API key → stub LLM, LanceDB durable, sandbox lokal', () => {
    const config = loadConfig({});
    expect(config.llmDriver).toBe('stub');
    expect(config.memoryDriver).toBe('lancedb');
    expect(config.sandboxDriver).toBe('local');
    expect(config.maxIterations).toBe(5);
    expect(config.tokenBudget).toBe(250_000);
    expect(config.sandboxTimeoutMs).toBe(60_000);
  });

  it('DATA_DIR default absolut; override dihormati (kontrak durability §2.1)', () => {
    const dflt = loadConfig({});
    expect(dflt.dataDir.endsWith('/data')).toBe(true);
    expect(dflt.dataDir.startsWith('/')).toBe(true);
    const custom = loadConfig({ DATA_DIR: '/var/ao3d' });
    expect(custom.dataDir).toBe('/var/ao3d');
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
    expect(config.memoryDriver).toBe('lancedb');
    expect(config.sandboxDriver).toBe('local');
  });

  it('driver eksplisit menang atas auto', () => {
    const config = loadConfig({ LLM_DRIVER: 'stub', ANTHROPIC_API_KEY: 'sk-ant-x' });
    expect(config.llmDriver).toBe('stub');
  });

  it('base URL override (9router / gateway lokal) diteruskan apa adanya', () => {
    const config = loadConfig({
      ANTHROPIC_BASE_URL: 'http://localhost:20128/v1',
      OPENAI_BASE_URL: 'http://localhost:20128/v1',
    });
    expect(config.anthropicBaseUrl).toBe('http://localhost:20128/v1');
    expect(config.openaiBaseUrl).toBe('http://localhost:20128/v1');
  });
});
