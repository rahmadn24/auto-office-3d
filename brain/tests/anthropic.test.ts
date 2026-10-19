import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnthropicLLM } from '../src/llm/anthropic';

const okBody = {
  content: [{ type: 'text', text: 'Halo dari model' }],
  usage: { input_tokens: 12, output_tokens: 34 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AnthropicLLM — driver produksi (fetch dimock)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sukses: endpoint default, header API key, parse text + usage', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(okBody));
    vi.stubGlobal('fetch', fetchMock);

    const llm = new AnthropicLLM('sk-ant-test', 'claude-haiku-4.5');
    const result = await llm.complete({
      task: 'prd',
      prompt: 'buat invoice generator',
      context: { projectName: 'AutoInvoice', retrieved: ['pola idempotency webhook'] },
    });

    expect(result.text).toBe('Halo dari model');
    expect(result.model).toBe('claude-haiku-4.5');
    expect(result.usage.inputTokens).toBe(12);
    expect(result.usage.outputTokens).toBe(34);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');

    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('claude-haiku-4.5');
    const content = body.messages[0].content as string;
    expect(content).toContain('AutoInvoice');
    expect(content).toContain('pola idempotency webhook');
    expect(content).toContain('buat invoice generator');
  });

  it('base URL override (9router) → {base}/messages tanpa slash dobel', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(okBody));
    vi.stubGlobal('fetch', fetchMock);

    const llm = new AnthropicLLM(
      'token-9router',
      'tokenomix/deepseek-v4.1-flash',
      'http://localhost:20128/v1/',
    );
    await llm.complete({ task: 'code', prompt: 'x', context: { projectName: 'p' } });

    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:20128/v1/messages');
  });

  it('HTTP error → melempar pesan berisi status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, _init?: RequestInit) => new Response('rate limited', { status: 429 }),
      ),
    );

    const llm = new AnthropicLLM('sk', 'm');
    await expect(
      llm.complete({ task: 'code', prompt: 'x', context: { projectName: 'p' } }),
    ).rejects.toThrow(/429/);
  });

  it('respons tanpa usage → estimasi token tetap > 0 (guardrail budget)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, _init?: RequestInit) =>
        jsonResponse({ content: [{ type: 'text', text: 'ok' }] }),
      ),
    );

    const llm = new AnthropicLLM('sk', 'm');
    const result = await llm.complete({
      task: 'prd',
      prompt: 'lorem ipsum dolor sit amet',
      context: { projectName: 'p' },
    });

    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });
});
