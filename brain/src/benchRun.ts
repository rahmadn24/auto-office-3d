import { loadConfig } from './config';
import { createLLM } from './llm';
import { parseFileBundle } from './llm/provider';
import { createSandbox } from './sandbox';
import { slugify } from './slug';
import { COVERAGE_THRESHOLD } from './sandbox/types';

/**
 * Satu putaran benchmark untuk SATU kandidat model (PRD v3.0 §2.2 — model veto).
 * Dipanggil oleh `scripts/bench-llm.mjs` via tsx dengan env per kandidat:
 *
 *   LLM_DRIVER=openai-compat OPENAI_COMPAT_BASE_URL=... \
 *   OPENAI_COMPAT_API_KEY=... OPENAI_COMPAT_MODEL=... \
 *   node --import tsx src/benchRun.ts
 *
 * Yang diuji bukan "bisa ngobrol", tapi 2 tugas produksi yang benar-benar
 * dipakai agensi: (1) menyusun PRD dan (2) menulis bundle TypeScript yang
 * lolos tsc + vitest dengan coverage ≥ 90% di sandbox lokal.
 * Output: satu baris `BENCH_RESULT:{json}` (dibaca orchestrator) + log manusia.
 */

interface BenchTask {
  id: string;
  directive: string;
}

/** Tiga brief representatif klien mikro (mewakili kerjaan agensi sehari-hari). */
const TASKS: BenchTask[] = [
  {
    id: 'invoice-saas',
    directive:
      'Micro-SaaS invoice generator dengan Stripe: billing bulanan, invoice PDF, webhook idempotent',
  },
  {
    id: 'analytics-landing',
    directive:
      'Landing page SaaS analytics dengan pricing table, waitlist email capture, dan social proof',
  },
  {
    id: 'mini-crm',
    directive: 'Mini CRM untuk freelancer: kelola klien, deal pipeline, dan reminder follow-up',
  },
];

const PRD_CHECKS: Array<{ id: string; re: RegExp }> = [
  { id: 'problem', re: /(problem|masalah|pain|pendahuluan|latar belakang)/i },
  { id: 'requirements', re: /(user stor|requirement|kebutuhan|fitur|acceptance)/i },
  { id: 'diagram', re: /(mermaid|flowchart|sequenceDiagram|diagram|arsitektur|architecture)/i },
  { id: 'stack', re: /(typescript|node\.?js|next\.?js|react|postgres|sqlite|stack)/i },
  { id: 'monetize', re: /(monetiz|revenue|pricing|harga|subscription|langganan|stripe)/i },
];

interface TaskResult {
  id: string;
  projectName: string;
  pm: {
    ok: boolean;
    checks: Record<string, boolean>;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
  };
  code: {
    ok: boolean;
    files: number;
    parseError?: string;
    typeCheckOk: boolean;
    testsTotal: number;
    testsFailed: number;
    coverage: number | null;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
  };
  ok: boolean;
}

async function runTask(
  task: BenchTask,
  llm: ReturnType<typeof createLLM>,
  sandbox: ReturnType<typeof createSandbox>,
  timeoutMs: number,
): Promise<TaskResult> {
  const projectName = slugify(task.directive);
  const runId = `bench_${task.id}`;

  // ── Tugas 1: PRD ──────────────────────────────────────────────────────
  const pmStart = Date.now();
  const pm = await llm.complete({
    task: 'prd',
    prompt: task.directive,
    context: { projectName },
  });
  const pmLatency = Date.now() - pmStart;
  const checks: Record<string, boolean> = {};
  for (const check of PRD_CHECKS) checks[check.id] = check.re.test(pm.text);
  const pmOk = Object.values(checks).filter(Boolean).length >= 4;

  // ── Tugas 2: codegen + verifikasi sandbox (tsc + vitest + coverage) ───
  const devStart = Date.now();
  const dev = await llm.complete({
    task: 'code',
    prompt: `${task.directive}\n\nSpesifikasi teknis (ringkas): 1 modul engine TypeScript + test vitest, tanpa dependensi eksternal selain vitest.`,
    context: { projectName, prd: pm.text, retrieved: [] },
  });
  const devLatency = Date.now() - devStart;

  let files: Record<string, string> = {};
  let parseError: string | undefined;
  try {
    files = parseFileBundle(dev.text);
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  let typeCheckOk = false;
  let testsTotal = 0;
  let testsFailed = 0;
  let coverage: number | null = null;
  let sandboxOk = false;

  if (Object.keys(files).length > 0) {
    const sandboxResult = await sandbox.run({
      runId,
      files,
      timeoutMs,
      coverage: true,
    });
    sandboxOk = sandboxResult.ok;
    typeCheckOk = sandboxResult.typeCheck.ok;
    testsTotal = sandboxResult.tests.total;
    testsFailed = sandboxResult.tests.failed;
    coverage = sandboxResult.tests.coverage?.statements ?? null;
  }

  const codeOk =
    parseError === undefined &&
    Object.keys(files).length >= 2 &&
    sandboxOk &&
    typeCheckOk &&
    testsTotal > 0 &&
    testsFailed === 0 &&
    coverage !== null &&
    coverage >= COVERAGE_THRESHOLD;

  console.log(
    `[bench]   ${task.id.padEnd(18)} prd=${pmOk ? 'PASS' : 'FAIL'} code=${codeOk ? 'PASS' : 'FAIL'} · files=${Object.keys(files).length} tsc=${typeCheckOk ? 'ok' : 'no'} tests=${testsTotal - testsFailed}/${testsTotal} cov=${coverage ?? '-'}%`,
  );

  return {
    id: task.id,
    projectName,
    pm: {
      ok: pmOk,
      checks,
      latencyMs: pmLatency,
      inputTokens: pm.usage.inputTokens,
      outputTokens: pm.usage.outputTokens,
    },
    code: {
      ok: codeOk,
      files: Object.keys(files).length,
      ...(parseError ? { parseError } : {}),
      typeCheckOk,
      testsTotal,
      testsFailed,
      coverage,
      latencyMs: devLatency,
      inputTokens: dev.usage.inputTokens,
      outputTokens: dev.usage.outputTokens,
    },
    ok: pmOk && codeOk,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const llm = createLLM(config);
  const sandbox = createSandbox(config);
  const limit = Number.parseInt(process.env.BENCH_TASKS ?? '', 10);
  const tasks = Number.isFinite(limit) && limit > 0 ? TASKS.slice(0, limit) : TASKS;

  console.log(`[bench] model=${config.model} driver=${config.llmDriver} tasks=${tasks.length}`);

  const results: TaskResult[] = [];
  for (const task of tasks) {
    results.push(await runTask(task, llm, sandbox, config.sandboxTimeoutMs));
  }

  const passed = results.filter((r) => r.ok).length;
  const passRate = results.length === 0 ? 0 : passed / results.length;
  const summary = {
    model: config.model,
    driver: config.llmDriver,
    ranAt: new Date().toISOString(),
    tasks: results,
    passed,
    total: results.length,
    passRate,
    /** Gate keputusan: ≥ 80% lolos (PRD v3.0 §2.2). */
    pass: passRate >= 0.8,
    tokens: {
      input: results.reduce((sum, r) => sum + r.pm.inputTokens + r.code.inputTokens, 0),
      output: results.reduce((sum, r) => sum + r.pm.outputTokens + r.code.outputTokens, 0),
    },
    latencyMs: results.reduce((sum, r) => sum + r.pm.latencyMs + r.code.latencyMs, 0),
  };

  console.log(
    `[bench] hasil: ${passed}/${results.length} task lolos (${Math.round(passRate * 100)}%) → ${summary.pass ? 'LULUS ≥80%' : 'GAGAL <80%'}`,
  );
  // Marker satu baris — dibaca scripts/bench-llm.mjs.
  console.log(`BENCH_RESULT:${JSON.stringify(summary)}`);
}

main().catch((err: unknown) => {
  console.error('[bench] harness error:', err);
  process.exitCode = 1;
});
