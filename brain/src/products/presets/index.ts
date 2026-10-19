import { customAppPreset } from './custom-app';
import { landingPreset } from './landing';
import { saasFullstackPreset } from './saas-fullstack';
import {
  PRODUCT_PRESET_IDS,
  type PresetRenderInput,
  type ProductPreset,
  type ProductPresetId,
  type RenderedPresetStack,
} from './types';

/**
 * Registry preset stack tier-1 (PRD §3.1 & §7 Fase 10).
 * PM memilih preset dari brief → tersimpan di state run → DevOps merender
 * Dockerfile + gate dari registry ini.
 */
export const PRODUCT_PRESETS: readonly ProductPreset[] = [
  landingPreset,
  saasFullstackPreset,
  customAppPreset,
];

export * from './types';
export { dockerfileFor, escapeHtml, pageShell, renderStack } from './stack';
export type { DemoMeta, StackSpec } from './stack';

/** Normalisasi id preset dari teks brief (`saas` → `saas-fullstack`). */
export function normalizePresetId(raw: string): ProductPresetId | null {
  const value = raw.trim().toLowerCase();
  if ((PRODUCT_PRESET_IDS as readonly string[]).includes(value)) return value as ProductPresetId;
  if (value === 'saas' || value === 'fullstack' || value === 'full-stack') return 'saas-fullstack';
  if (value === 'app' || value === 'custom') return 'custom-app';
  return null;
}

export function isProductPresetId(value: unknown): value is ProductPresetId {
  return typeof value === 'string' && (PRODUCT_PRESET_IDS as readonly string[]).includes(value);
}

/** Resolusi preset: id tak dikenal jatuh ke default PM (`saas-fullstack`). */
export function resolvePreset(id?: string | null): ProductPreset {
  const found = PRODUCT_PRESETS.find((preset) => preset.id === id);
  return found ?? saasFullstackPreset;
}

export function renderPresetStack(
  id: string | undefined | null,
  input: PresetRenderInput,
): RenderedPresetStack {
  return resolvePreset(id).render(input);
}

/**
 * Pilihan preset oleh PM (kartu 10.1): baris eksplisit `Preset stack: X` dari
 * brief menang; tanpa itu heuristik keyword — konsisten dengan
 * `heuristicBriefDraft` (llm/provider.ts) supaya run langsung & jalur briefing
 * memilih preset yang sama.
 */
export function detectPreset(directive: string): ProductPresetId {
  const explicit = /preset(?:\s*stack)?\s*[:=]\s*([a-z-]+)/i.exec(directive);
  if (explicit?.[1]) {
    const normalized = normalizePresetId(explicit[1]);
    if (normalized) return normalized;
  }
  const lower = directive.toLowerCase();
  if (/\blanding\b|\bwaitlist\b|marketing page/.test(lower)) return 'landing';
  if (
    /(dashboard|saas|full[- ]?stack|subscription|multi[- ]?tenant|checkout|billing)/.test(lower)
  ) {
    return 'saas-fullstack';
  }
  return 'custom-app';
}
