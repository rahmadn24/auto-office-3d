import { ENGINE_SPEC_TS, BILLING_SPEC_TS, ENGINE_TS, TYPES_TS, billingTs } from '../safeBuild';
import { slugify } from '../slug';
import {
  estimateTokens,
  type LLMProvider,
  type LLMRequest,
  type LLMResult,
} from './provider';

function titleCase(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Driver offline 100% deterministik (tanpa API key).
 * PRD yang dihasilkan selalu konsisten, dan bundle kode-nya benar-benar lolos
 * `tsc --noEmit` + `vitest run` di dalam sandbox — sehingga loop Dev⇄QA
 * dan circuit breaker bisa diuji secara nyata tanpa membakar token.
 */
export class StubLLM implements LLMProvider {
  readonly driver = 'stub';
  readonly model = 'deterministic-stub-v1';

  async complete(request: LLMRequest): Promise<LLMResult> {
    const text = request.task === 'prd' ? prdDocument(request) : codeBundle(request);
    const inputTokens =
      estimateTokens(request.prompt) + estimateTokens(JSON.stringify(request.context));
    const outputTokens = estimateTokens(text);
    return { text, model: this.model, usage: { inputTokens, outputTokens } };
  }
}

function prdDocument(request: LLMRequest): string {
  const name = titleCase(request.context.projectName);
  const prompt = request.prompt.trim();
  const recalled = request.context.retrieved ?? [];
  const citation = (i: number) => recalled[i] ?? 'No prior recall in namespace pm-memory';

  return [
    `# ${name}`,
    '',
    '## 01 / Executive Summary',
    '',
    `${name} is an autonomous micro-SaaS generated from the Founder directive: "${prompt}".`,
    'It decouples product logic from billing orchestration and ships with deterministic QA gates.',
    '',
    'Target audience: technical founders and indie hackers who want zero-touch delivery.',
    '',
    '## 02 / User Stories & Functional Scope',
    '',
    '### US-801 · CORE ENGINE',
    'As a customer, I want the pricing engine to compute totals deterministically.',
    '',
    '- AC1: Subtotal sums every line item (amountCents * qty).',
    '- AC2: Percentage discount is applied with rounding to the nearest cent.',
    '- AC3: Out-of-range discount throws a RangeError.',
    '',
    '### US-802 · BILLING INTEGRITY',
    'As the system operator, I need idempotent invoice totals for webhook retries.',
    '',
    '- AC1: Repeated calculation of the same input returns the identical total.',
    '- AC2: Empty cart returns 0.',
    '',
    '## 03 / Data Contract & Schema Integrity',
    '',
    '```ts',
    'export interface LineItem {',
    '  description: string;',
    '  amountCents: number;',
    '  qty: number;',
    '}',
    '```',
    '',
    '## 04 / Vector DB Context Citations (RAG)',
    '',
    `- pm-memory[0]: ${citation(0)}`,
    `- pm-memory[1]: ${citation(1)}`,
    '',
  ].join('\n');
}

function codeBundle(request: LLMRequest): string {
  const bundle = {
    files: {
      'src/types.ts': TYPES_TS,
      'src/lib/engine.ts': ENGINE_TS,
      'src/lib/billing.ts': billingTs(slugify(request.context.projectName)),
      'tests/engine.spec.ts': ENGINE_SPEC_TS,
      'tests/billing.spec.ts': BILLING_SPEC_TS,
    },
  };
  return JSON.stringify(bundle, null, 2);
}
