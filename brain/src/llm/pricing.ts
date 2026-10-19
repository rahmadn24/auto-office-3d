import type { TokenUsage } from '../telemetry/tokens';

/**
 * Tabel harga model per 1 juta token (USD) — sumber benchmark internal
 * (Fase 7 & 13). Dipakai untuk estimasi biaya per run; angka dibulatkan
 * dari daftar harga publik provider saat benchmark terakhir dijalankan.
 *
 * Kunci dicocokkan sebagai awalan nama model (lowercase) — mis.
 * `tokenomix/deepseek-v4.1-flash` cocok dengan `deepseek-v4.1-flash`.
 */
export interface ModelPricing {
  label: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-3-5-sonnet': { label: 'Claude 3.5 Sonnet', inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-3-5-haiku': { label: 'Claude 3.5 Haiku', inputPerMTok: 1.0, outputPerMTok: 5.0 },
  'claude-haiku-4.5': { label: 'Claude Haiku 4.5', inputPerMTok: 1.0, outputPerMTok: 5.0 },
  'gpt-4o-mini': { label: 'GPT-4o mini', inputPerMTok: 0.15, outputPerMTok: 0.6 },
  'gpt-4o': { label: 'GPT-4o', inputPerMTok: 2.5, outputPerMTok: 10.0 },
  'deepseek-v4.1-flash': { label: 'DeepSeek 4.1 Flash', inputPerMTok: 0.1, outputPerMTok: 0.4 },
  'deepseek-chat': { label: 'DeepSeek Chat', inputPerMTok: 0.27, outputPerMTok: 1.1 },
};

/** Normalisasi nama model (buang prefix provider, lowercase). */
function normalizeModel(model: string): string {
  const last = model.split('/').pop() ?? model;
  return last.trim().toLowerCase();
}

/** Cari entri harga: exact match dulu, lalu awalan terpanjang. */
export function pricingFor(model: string): ModelPricing | null {
  const name = normalizeModel(model);
  if (!name) return null;
  const exact = MODEL_PRICING[name];
  if (exact) return exact;
  let best: { key: string; pricing: ModelPricing } | null = null;
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (name.startsWith(key) && (!best || key.length > best.key.length)) best = { key, pricing };
  }
  return best?.pricing ?? null;
}

/** Estimasi biaya satu request/run (USD); null bila model tak ada di tabel. */
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const pricing = pricingFor(model);
  if (!pricing) return null;
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTok +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTok
  );
}

/** Format biaya ringkas untuk laporan run ("$0.0123", "<$0.0001"). */
export function formatCostUsd(usd: number | null): string {
  if (usd === null) return 'n/a';
  if (usd > 0 && usd < 0.0001) return '<$0.0001';
  return `$${usd.toFixed(4)}`;
}
