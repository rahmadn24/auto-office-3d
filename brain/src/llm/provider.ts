/** Provider LLM — production: Claude 3.5 Sonnet (Anthropic), offline: stub deterministik. */

import type { BriefPreset } from '../types';

export type LLMTask = 'prd' | 'code' | 'briefing' | 'brief' | 'cs';

export interface LLMContext {
  projectName: string;
  prd?: string;
  retrieved?: string[];
  /** Transkrip percakapan Briefing Room (task briefing & brief, Fase 8). */
  thread?: string;
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

/* ───────── Fase 8 — Briefing Room (PRD §3.1) ───────── */

/** Prompt PM Briefing — diskusi multi-turn dengan Founder sebelum run otonom. */
export function briefingSystemPrompt(): string {
  return [
    'You are the PM Agent of AutoOffice3D running the Briefing Phase (Division: Product).',
    'The founder is discussing the product BEFORE the autonomous run starts.',
    'Ask sharp clarifying questions (audience, must-have features, stack preset, pricing anchor),',
    'offer architecture or business alternatives, and reference retrieved memory when relevant.',
    'Keep replies under 120 words, write in the same language as the founder,',
    'and always end with 2-3 numbered follow-up questions.',
  ].join('\n');
}

/** Prompt compile brief — ringkas thread diskusi jadi brief terstruktur (tombol GO). */
export function briefSystemPrompt(): string {
  return [
    'You are the PM Agent of AutoOffice3D compiling a briefing thread into a structured brief.',
    'Reply with ONLY a JSON object of this exact shape and no commentary:',
    '{"audience": string, "features": string[], "preset": "landing" | "saas-fullstack" | "custom-app", "pricing": string, "summary": string}',
    'features: 3-5 must-have capabilities. pricing: one concrete anchor (e.g. "$29/mo").',
  ].join('\n');
}

/* ───────── Fase 11 — CS Agent (PRD §3.5) ───────── */

/** Prompt CS — balas pertanyaan client, ajukan quote, jaga thread tetap ramah. */
export function csSystemPrompt(): string {
  return [
    'You are the Customer Success Agent of AutoOffice3D (Division: Customer Success).',
    'A client is chatting with you from an omnichannel inbox (widget, WhatsApp, or email).',
    'Answer their question about the product, reference retrieved memory when relevant,',
    'and when they show buying intent propose one concrete quote (price + what is included).',
    'Keep replies under 90 words, write in the same language as the client, professional and warm.',
  ].join('\n');
}

export interface BriefDraft {
  audience: string;
  features: string[];
  preset: BriefPreset;
  pricing: string;
  summary: string;
}

/** Ambil BriefDraft dari balasan model (toleran code fence); null bila tidak valid. */
export function parseBriefDraft(text: string): BriefDraft | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  let parsed: Partial<BriefDraft>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<BriefDraft>;
  } catch {
    return null;
  }
  const preset = parsed.preset;
  if (preset !== 'landing' && preset !== 'saas-fullstack' && preset !== 'custom-app') return null;
  if (typeof parsed.audience !== 'string' || parsed.audience.trim().length === 0) return null;
  if (typeof parsed.pricing !== 'string' || parsed.pricing.trim().length === 0) return null;
  if (typeof parsed.summary !== 'string' || parsed.summary.trim().length === 0) return null;
  if (!Array.isArray(parsed.features)) return null;
  const features = parsed.features
    .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    .slice(0, 6);
  if (features.length === 0) return null;
  return {
    audience: parsed.audience.trim(),
    features,
    preset,
    pricing: parsed.pricing.trim(),
    summary: parsed.summary.trim(),
  };
}

/**
 * Draft brief heuristik deterministik — dipakai driver stub & fallback saat
 * model live membalas non-JSON (brief tetap terbentuk, GO tak pernah mentok).
 * Input: transkrip "Founder: … / PM: …".
 */
export function heuristicBriefDraft(transcript: string): BriefDraft {
  const founderLines = transcript
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Founder:'))
    .map((line) => line.slice('Founder:'.length).trim())
    .join(' ');
  const source = founderLines || transcript;
  const text = source.toLowerCase();

  const preset: BriefPreset = /\blanding\b/.test(text)
    ? 'landing'
    : /(dashboard|saas|full[- ]?stack|subscription|multi[- ]?tenant)/.test(text)
      ? 'saas-fullstack'
      : 'custom-app';
  const price = /(?:\$|usd\s*)\s?(\d+(?:[.,]\d+)?)/i.exec(source);
  const pricing = price ? `$${price[1]}/mo` : '$29/mo (Starter · ARR $348)';
  const audience = /freelanc|agenc/.test(text)
    ? 'freelancers & small agencies'
    : /enterprise|b2b|\bteam\b/.test(text)
      ? 'B2B product teams'
      : 'technical founders & indie hackers';

  const seen = new Set<string>();
  const features: string[] = [];
  for (const chunk of source.split(/[\n.;!?]+/).map((s) => s.trim().replace(/^[-•*]\s*/, ''))) {
    if (chunk.length < 12 || chunk.length > 90) continue;
    const key = chunk.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    features.push(chunk);
    if (features.length >= 4) break;
  }

  const firstLine =
    source
      .split(/[\n.!?]/)
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? 'produk micro-SaaS';
  return {
    audience,
    features:
      features.length > 0
        ? features
        : ['core pricing engine', 'checkout + invoice flow', 'customer dashboard'],
    preset,
    pricing,
    summary: `Brief dari diskusi Founder↔PM: ${firstLine.slice(0, 160)}`,
  };
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

/** System prompt per task — dipakai semua driver produksi (Anthropic & OpenAI-compat). */
export function systemPromptFor(task: LLMTask): string {
  switch (task) {
    case 'prd':
      return prdSystemPrompt();
    case 'code':
      return codeSystemPrompt();
    case 'brief':
      return briefSystemPrompt();
    case 'briefing':
      return briefingSystemPrompt();
    case 'cs':
      return csSystemPrompt();
  }
}
