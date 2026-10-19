import type { Config } from '../config';
import { AnthropicLLM } from './anthropic';
import { StubLLM } from './stub';
import type { LLMProvider } from './provider';

export * from './provider';

export function createLLM(config: Config): LLMProvider {
  if (config.llmDriver === 'anthropic') {
    if (!config.anthropicApiKey) {
      throw new Error('LLM_DRIVER=anthropic but ANTHROPIC_API_KEY is missing');
    }
    return new AnthropicLLM(config.anthropicApiKey, config.model, config.anthropicBaseUrl);
  }
  return new StubLLM();
}
