import {
  estimateTokens,
  systemPromptFor,
  type LLMProvider,
  type LLMRequest,
  type LLMResult,
} from './provider';

export interface OpenAICompatLLMOptions {
  /** Batas waktu satu request (ms). Default 120 detik. */
  timeoutMs?: number;
  /** Retry otomatis untuk 429/5xx & error jaringan. Default 2 (total 3 percobaan). */
  maxRetries?: number;
  /** Jeda dasar backoff eksponensial (ms). Default 500. */
  retryDelayMs?: number;
  /**
   * Override model per LLMTask (`prd`/`code`/`briefing`/`brief`/`cs`). Dipakai
   * 9router untuk memetakan divisi ke model berbeda (GLM/DeepSeek/MiMo);
   * task tanpa entry memakai model default konstruktor.
   */
  taskModels?: Partial<Record<string, string>>;
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

interface ChatContentPart {
  type?: string;
  text?: string;
}

interface ChatCompletionBody {
  choices?: Array<{
    message?: { content?: string | ChatContentPart[] | null };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Driver LLM OpenAI-compatible (Fase 13) — POST `/chat/completions`.
 *
 * Banyak provider murah (DeepSeek, Groq, OpenRouter, gateway 9router) memakai
 * format OpenAI, bukan Anthropic Messages. `baseUrl` fleksibel (mis.
 * `http://localhost:20128/v1` untuk 9router). Dilengkapi timeout + retry
 * backoff yang sama dengan driver Anthropic.
 */
export class OpenAICompatLLM implements LLMProvider {
  readonly driver = 'openai-compat';
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly taskModels: Partial<Record<string, string>>;

  constructor(
    private readonly apiKey: string,
    readonly model: string = 'gpt-4o-mini',
    private readonly baseUrl: string = 'https://api.openai.com/v1',
    options: OpenAICompatLLMOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.taskModels = options.taskModels ?? {};
  }

  get endpoint(): string {
    return `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  }

  /** POST dengan timeout + retry eksponensial; 4xx non-retryable langsung dikembalikan. */
  private async post(payload: unknown): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await sleep(this.retryDelayMs * 2 ** (attempt - 1));
      try {
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (isRetryableStatus(res.status) && attempt < this.maxRetries) {
          lastError = new Error(`OpenAI-compatible request failed (${res.status})`);
          continue;
        }
        return res;
      } catch (err) {
        const name = errorName(err);
        const timedOut = name === 'TimeoutError' || name === 'AbortError';
        lastError = timedOut
          ? new Error(`OpenAI-compatible request timed out after ${this.timeoutMs}ms`)
          : new Error(
              `OpenAI-compatible request error: ${err instanceof Error ? err.message : String(err)}`,
            );
        if (attempt >= this.maxRetries) throw lastError;
      }
    }

    throw lastError ?? new Error('OpenAI-compatible request failed');
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const model = this.taskModels[request.task] ?? this.model;
    const system = systemPromptFor(request.task);
    const user = [
      `Project name: ${request.context.projectName}`,
      request.context.prd ? `\nPRD:\n${request.context.prd}` : '',
      request.context.retrieved?.length
        ? `\nRetrieved memory (use if relevant):\n- ${request.context.retrieved.join('\n- ')}`
        : '',
      request.context.thread ? `\nConversation so far:\n${request.context.thread}` : '',
      request.task === 'brief'
        ? `\nBriefing transcript:\n${request.prompt}`
        : request.task === 'cs'
          ? `\nClient message:\n${request.prompt}`
          : `\nFounder directive:\n${request.prompt}`,
    ].join('\n');

    // Task yang kontraknya JSON (`code`/`brief`) meminta JSON mode. Beberapa
    // provider OpenAI-compatible belum mendukung field ini; fallback ke request
    // biasa bila gateway menolaknya (400/422), jangan gagalkan run.
    const wantsJson = request.task === 'code' || request.task === 'brief';
    const payload: Record<string, unknown> = {
      model,
      max_tokens: request.maxOutputTokens ?? 4096,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    if (wantsJson) payload.response_format = { type: 'json_object' };

    let res = await this.post(payload);
    if (wantsJson && (res.status === 400 || res.status === 422)) {
      delete payload.response_format;
      res = await this.post(payload);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenAI-compatible request failed (${res.status}): ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as ChatCompletionBody;
    const choice = json.choices?.[0];
    const content = choice?.message?.content;
    const text = Array.isArray(content)
      ? content.map((part) => (typeof part.text === 'string' ? part.text : '')).join('\n')
      : (content ?? '');

    return {
      text,
      model,
      ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? estimateTokens(user + system),
        outputTokens: json.usage?.completion_tokens ?? estimateTokens(text),
      },
    };
  }
}
