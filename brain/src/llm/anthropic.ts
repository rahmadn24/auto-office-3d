import {
  codeSystemPrompt,
  estimateTokens,
  prdSystemPrompt,
  type LLMProvider,
  type LLMRequest,
  type LLMResult,
} from './provider';

export interface AnthropicLLMOptions {
  /** Batas waktu satu request (ms). Default 120 detik. */
  timeoutMs?: number;
  /** Retry otomatis untuk 429/5xx & error jaringan. Default 2 (total 3 percobaan). */
  maxRetries?: number;
  /** Jeda dasar backoff eksponensial (ms). Default 500. */
  retryDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function errorName(err: unknown): string {
  return typeof err === 'object' && err !== null && 'name' in err
    ? String((err as { name: unknown }).name)
    : '';
}

/**
 * Driver produksi: Anthropic Messages API (Claude 3.5 Sonnet) — PRD §2.1.
 * Dipanggil via fetch tanpa SDK agar dependency brain tetap ringan.
 * `baseUrl` dapat diarahkan ke gateway kompatibel-Anthropic (mis. 9router lokal).
 * Dilengkapi timeout per request + retry backoff (429/5xx/jaringan).
 */
export class AnthropicLLM implements LLMProvider {
  readonly driver = 'anthropic';
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly apiKey: string,
    readonly model: string = 'claude-3-5-sonnet-latest',
    private readonly baseUrl: string = 'https://api.anthropic.com/v1',
    options: AnthropicLLMOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 500;
  }

  get endpoint(): string {
    return `${this.baseUrl.replace(/\/+$/, '')}/messages`;
  }

  /** POST dengan timeout + retry eksponensial; status 4xx non-retryable langsung dikembalikan. */
  private async post(payload: unknown): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await sleep(this.retryDelayMs * 2 ** (attempt - 1));
      try {
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (isRetryableStatus(res.status) && attempt < this.maxRetries) {
          lastError = new Error(`Anthropic request failed (${res.status})`);
          continue;
        }
        return res;
      } catch (err) {
        const name = errorName(err);
        const timedOut = name === 'TimeoutError' || name === 'AbortError';
        lastError = timedOut
          ? new Error(`Anthropic request timed out after ${this.timeoutMs}ms`)
          : new Error(
              `Anthropic request error: ${err instanceof Error ? err.message : String(err)}`,
            );
        if (attempt >= this.maxRetries) throw lastError;
      }
    }

    throw lastError ?? new Error('Anthropic request failed');
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const system = request.task === 'prd' ? prdSystemPrompt() : codeSystemPrompt();
    const user = [
      `Project name: ${request.context.projectName}`,
      request.context.prd ? `\nPRD:\n${request.context.prd}` : '',
      request.context.retrieved?.length
        ? `\nRetrieved memory (use if relevant):\n- ${request.context.retrieved.join('\n- ')}`
        : '',
      `\nFounder directive:\n${request.prompt}`,
    ].join('\n');

    const res = await this.post({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Anthropic request failed (${res.status}): ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = json.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');

    return {
      text,
      model: this.model,
      usage: {
        inputTokens: json.usage?.input_tokens ?? estimateTokens(user + system),
        outputTokens: json.usage?.output_tokens ?? estimateTokens(text),
      },
    };
  }
}
