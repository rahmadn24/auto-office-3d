import { z } from 'zod';

import { PRODUCT_PRESET_IDS, detectPreset } from '../products/presets';

/**
 * State global satu run otonom (PRD §3).
 * Setiap node mengembalikan PATCH (partial) — reducer default adalah overwrite,
 * sehingga collection (artifacts/logs) wajib ditulis ulang utuh oleh node-nya.
 */
export const RunStateSchema = z.object({
  runId: z.string(),
  founderPrompt: z.string(),
  projectName: z.string(),
  stage: z.enum([
    'received',
    'spec',
    'coding',
    'testing',
    'deploying',
    'growth',
    'done',
    'fallback',
    'failed',
    'halted',
  ]),
  /** path → isi berkas hasil codegen */
  artifacts: z.record(z.string(), z.string()),
  /** Preset stack produk (PRD §3.1) — dipilih PM dari brief/directive. */
  preset: z.enum(PRODUCT_PRESET_IDS).default('saas-fullstack'),
  prd: z.string().default(''),
  iteration: z.number().int().nonnegative().default(0),
  maxIterations: z.number().int().positive().default(5),
  lastQaSummary: z.string().default(''),
  qaPassed: z.boolean().default(false),
  typeErrors: z.array(z.string()).default([]),
  /** true bila circuit breaker trip → fallback safe-build (PRD §3.2) */
  fallbackTriggered: z.boolean().default(false),
  /** GRAPH LOCKED — loop retry ditutup setelah trip (PRD §3.2) */
  graphLocked: z.boolean().default(false),
  /** Hasil diff per-berkas terakhir (Dev Agent → sandbox) */
  diffs: z
    .record(
      z.string(),
      z.object({
        status: z.enum(['created', 'modified', 'deleted', 'unchanged']),
        added: z.number().int().nonnegative(),
        removed: z.number().int().nonnegative(),
      }),
    )
    .default({}),
  liveUrl: z.string().default(''),
  repoUrl: z.string().default(''),
  healthOk: z.boolean().default(false),
  hasCustomers: z.boolean().default(false),
  logs: z.array(z.string()).default([]),
  tokensUsed: z.number().int().nonnegative().default(0),
  model: z.string().default('stub'),
  latencyMs: z.number().int().nonnegative().default(0),
});

export type RunState = z.infer<typeof RunStateSchema>;
export type RunStatePatch = Partial<RunState>;

export function initialState(input: {
  runId: string;
  founderPrompt: string;
  projectName: string;
  maxIterations: number;
  model: string;
}): RunState {
  return RunStateSchema.parse({
    ...input,
    stage: 'received',
    artifacts: {},
    preset: detectPreset(input.founderPrompt),
  });
}
