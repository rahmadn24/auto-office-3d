/** Provider LLM — production: Claude 3.5 Sonnet (Anthropic), offline: stub deterministik. */

export type LLMTask = 'prd' | 'code';

export interface LLMContext {
  projectName: string;
  prd?: string;
  retrieved?: string[];
}

export interface LLMRequest {
  task: LLMTask;
  prompt: string;
  context: LLMContext;
}

export interface LLMResult {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  readonly driver: string;
  readonly model: string;
  complete(request: LLMRequest): Promise<LLMResult>;
}

/** Prompt PRD — dipakai driver stub dan anthropic dengan wording yang sama. */
export function prdSystemPrompt(): string {
  return [
    'You are the PM Agent of AutoOffice3D (Division: Product).',
    'Write a strict Markdown PRD containing exactly these sections:',
    '# <Product Name>',
    '## 01 / Executive Summary',
    '## 02 / User Stories & Functional Scope  (US-801, US-802, ... each with Acceptance Criteria)',
    '## 03 / Data Contract & Schema Integrity (TypeScript interface)',
    '## 04 / Vector DB Context Citations (RAG)',
    'No commentary outside the document.',
  ].join('\n');
}

/** Prompt codegen — output WAJIB berupa JSON {"files": {"path": "content"}}. */
export function codeSystemPrompt(): string {
  return [
    'You are the Core Dev Agent of AutoOffice3D (Division: Engineering).',
    'Read the PRD and emit ONLY a JSON object of this exact shape:',
    '{"files": {"src/lib/engine.ts": "...", "tests/engine.spec.ts": "..."}}',
    'Rules: TypeScript strict, no external imports except "vitest" in tests,',
    'tests use vitest (describe/it/expect), all files must compile with tsc --noEmit.',
  ].join('\n');
}

/** Ambil objek {files:{...}} dari balasan model (toleran terhadap code fence). */
export function parseFileBundle(text: string): Record<string, string> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('LLM reply does not contain a JSON file bundle');
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { files?: Record<string, string> };
  if (!parsed.files || typeof parsed.files !== 'object') {
    throw new Error('LLM reply is missing the "files" map');
  }
  return parsed.files;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
