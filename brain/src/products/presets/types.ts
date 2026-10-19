/**
 * Preset stack tier-1 (PRD §3.1 "Preset Selection" & §7 Fase 10).
 *
 * PM memilih salah satu preset dari brief (field `preset`) → disimpan di state
 * run → dipakai DevOps untuk menyusun Dockerfile + gate deploy. Untuk sekarang
 * hanya stack TypeScript/Node (tier-1); stack lain menyusul bila ada demand.
 */
export const PRODUCT_PRESET_IDS = ['landing', 'saas-fullstack', 'custom-app'] as const;
export type ProductPresetId = (typeof PRODUCT_PRESET_IDS)[number];

export interface PresetRenderInput {
  projectName: string;
  slug: string;
  /** Ringkasan brief/directive → tagline halaman demo. */
  tagline?: string;
  pricing?: string;
  runId?: string;
  /**
   * Widget channel CS (Fase 11) — halaman produk menyisipkan widget yang
   * terhubung ke Brain lewat socket (visitor bisa chat dengan CS Agent).
   */
  widget?: { url: string; socketPath?: string };
}

export interface RenderedPresetStack {
  preset: ProductPresetId;
  /** Port yang didengarkan container (dipetakan ke host oleh DEPLOY_DRIVER=docker). */
  port: number;
  /** Path health check di dalam produk (diprobe sebelum status READY). */
  healthPath: string;
  /** Perintah gate yang dieksekusi sebagai RUN saat `docker build`. */
  gate: string;
  dockerfile: string;
  /** Berkas runtime produk: app.mjs / server.mjs / selftest.mjs / README.md (+ package.json). */
  files: Record<string, string>;
}

export interface ProductPreset {
  id: ProductPresetId;
  label: string;
  description: string;
  /** Batasan tier-1 — stack di luar TypeScript/Node belum didukung. */
  tier1: string;
  port: number;
  healthPath: string;
  /** Tanda di direktif/brief yang dipakai PM untuk memilih preset (heuristik). */
  keywords: readonly string[];
  render(input: PresetRenderInput): RenderedPresetStack;
}
