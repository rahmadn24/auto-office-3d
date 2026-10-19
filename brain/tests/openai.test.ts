import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenAICompatLLM } from '../src/llm/openai';

const okBody = {
  choices: [{ message: { content: 'Halo dari model' } }],
  usage: { prompt_tokens: 12, completion_tokens: 34 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OpenAICompatLLM — driver provider murah ber-format OpenAI (Fase 13)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sukses: endpoint default, header Bearer, messages system+user, parse text + usage', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(okBody));
    vi.stubGlobal('fetch', fetchMock);

    const llm = new OpenAICompatLLM('sk-compat-test', 'deepseek-v4.1-flash');
    const result = await llm.complete({
      task: 'prd',
      prompt: 'buat invoice generator',
      context: { projectName: 'AutoInvoice', retrieved: ['pola idempotency webhook'] },
    });

    expect(result.text).toBe('Halo dari model');
    expect(result.model).toBe('deepseek-v4.1-flash');
    expect(result.usage.inputTokens).toBe(12);
    expect(result.usage.outputTokens).toBe(34);
    expect(llm.driver).toBe('openai-compat');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-compat-test');
    const body = JSON.parse(String((init as RequestInit).body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('deepseek-v4.1-flash');
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(body.messages[1]!.content).toContain('buat invoice generator');
    expect(body.messages[1]!.content).toContain('pola idempotency webhook');
  });

  it('base URL override (9router) dinormalkan — trailing slash tidak bikin URL dobel', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(okBody));
    vi.stubGlobal('fetch', fetchMock);

    const llm = new OpenAICompatLLM('sk', 'm', 'http://localhost:20128/v1/');
    await llm.complete({ task: 'code', prompt: 'x', context: { projectName: 'p' } });

    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:20128/v1/chat/completions');
  });

  it('konten bertipe array (provider variatif) → digabung menjadi teks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, _init?: RequestInit) =>
        jsonResponse({
          choices: [
            {
              message: {
                content: [
                  { type: 'text', text: 'baris satu' },
                  { type: 'text', text: 'baris dua' },
                ],
              },
            },
          ],
        }),
      ),
    );

    const llm = new OpenAICompatLLM('sk', 'm');
    const result = await llm.complete({
      task: 'briefing',
      prompt: 'x',
      context: { projectName: 'p' },
    });
    expect(result.text).toBe('baris satu\nbaris dua');
  });

  it('HTTP error non-retryable (400) → langsung melempar pesan berisi status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, _init?: RequestInit) => new Response('bad request', { status: 400 }),
      ),
    );

    const llm = new OpenAICompatLLM('sk', 'm');
    await expect(
      llm.complete({ task: 'code', prompt: 'x', context: { projectName: 'p' } }),
    ).rejects.toThrow(/400/);
  });

  it('respons tanpa usage → estimasi token tetap > 0 (guardrail budget)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, _init?: RequestInit) =>
        jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
      ),
    );

    const llm = new OpenAICompatLLM('sk', 'm');
    const result = await llm.complete({
      task: 'prd',
      prompt: 'lorem ipsum dolor sit amet',
      context: { projectName: 'p' },
    });

    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it('retry: 500 lalu sukses → satu percobaan ulang, hasil akhir valid', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(okBody));
    fetchMock.mockImplementationOnce(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const llm = new OpenAICompatLLM('sk', 'm', undefined, { retryDelayMs: 5 });
    const result = await llm.complete({ task: 'code', prompt: 'x', context: { projectName: 'p' } });

    expect(result.text).toBe('Halo dari model');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retry habis: 503 → 3 percobaan (maxRetries=2) lalu melempar status terakhir', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('down', { status: 503 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const llm = new OpenAICompatLLM('sk', 'm', undefined, { retryDelayMs: 5 });
    await expect(
      llm.complete({ task: 'code', prompt: 'x', context: { projectName: 'p' } }),
    ).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('timeout: request melewati batas waktu → error jelas tanpa percobaan ulang', async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const llm = new OpenAICompatLLM('sk', 'm', undefined, {
      timeoutMs: 25,
      maxRetries: 0,
      retryDelayMs: 5,
    });
    await expect(
      llm.complete({ task: 'code', prompt: 'x', context: { projectName: 'p' } }),
    ).rejects.toThrow(/timed out after 25ms/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
