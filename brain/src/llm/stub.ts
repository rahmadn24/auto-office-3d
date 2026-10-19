import { codeBundleFiles } from '../safeBuild';
import { slugify } from '../slug';
import {
  estimateTokens,
  heuristicBriefDraft,
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
    const text =
      request.task === 'prd'
        ? prdDocument(request)
        : request.task === 'code'
          ? codeBundle(request)
          : request.task === 'brief'
            ? briefDraft(request)
            : briefingReply(request);
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
    '## 00 / Problem & Opportunity',
    '',
    `The problem: clients want "${prompt}" delivered without hiring a full team.`,
    'Existing tools still need a human to stitch product logic, billing, and QA together.',
    'Opportunity: an autonomous pipeline that ships a verified micro-SaaS in one run.',
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
    '## 05 / Architecture & Stack',
    '',
    'Stack: TypeScript (strict) on the Node.js runtime, vitest for tests, Stripe for monetization rails.',
    '',
    '```mermaid',
    'flowchart LR',
    '  F[Founder directive] --> PM[PM Agent · PRD]',
    '  PM --> DEV[Dev Agent · codegen]',
    '  DEV --> QA[QA Agent · tsc + vitest]',
    '  QA -- pass --> DEP[Deploy · live URL]',
    '  QA -- fail --> DEV',
    '  DEP --> GR[Growth · first customers]',
    '```',
    '',
    '## 06 / Monetization & Pricing',
    '',
    'Subscription tiers with Stripe Checkout; pricing anchors on monthly active seats.',
    'Revenue events stream back into the office for the founder dashboard.',
    '',
  ].join('\n');
}

function codeBundle(request: LLMRequest): string {
  return JSON.stringify({ files: codeBundleFiles(slugify(request.context.projectName)) }, null, 2);
}

/**
 * Balasan PM Briefing deterministik (Fase 8) — referensi pesan terakhir +
 * pertanyaan klarifikasi tetap; memori yang ter-recall ikut dikutip.
 */
function briefingReply(request: LLMRequest): string {
  const message = request.prompt.trim().replace(/\s+/g, ' ');
  const short = message.length > 96 ? `${message.slice(0, 96)}…` : message;
  const recalled = request.context.retrieved ?? [];
  const lines = [
    `Noted — "${short}". Sebelum saya kunci brief-nya, tiga hal ini dulu:`,
    '',
    '1. Audience utama versi pertama siapa (indie hacker, agensi, atau tim B2B)?',
    '2. Fitur wajib yang tidak boleh absen apa saja (mis. invoice, checkout, dashboard)?',
    '3. Preset stack & anchor harga — `landing`, `saas-fullstack`, atau `custom-app`, dan harga (mis. $29/mo)?',
  ];
  if (recalled.length > 0) {
    lines.push('', `Catatan dari memori: ${recalled[0]}`);
  }
  return lines.join('\n');
}

/** Brief terstruktur deterministik (JSON) dari transkrip thread — tombol GO. */
function briefDraft(request: LLMRequest): string {
  const transcript = request.prompt.trim() || (request.context.thread ?? '');
  return JSON.stringify(heuristicBriefDraft(transcript), null, 2);
}
