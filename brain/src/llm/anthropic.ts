import {
  codeSystemPrompt,
  estimateTokens,
  prdSystemPrompt,
  type LLMProvider,
  type LLMRequest,
  type LLMResult,
} from './provider';

/**
 * Driver produksi: Anthropic Messages API (Claude 3.5 Sonnet) — PRD §2.1.
 * Dipanggil via fetch tanpa SDK agar dependency brain tetap ringan.
 */
export class AnthropicLLM implements LLMProvider {
  readonly driver = 'anthropic';

  constructor(
    private readonly apiKey: string,
    readonly model: string = 'claude-3-5-sonnet-latest',
    private readonly url = 'https://api.anthropic.com/v1/messages',
  ) {}

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

    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content: user }],
      }),
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
