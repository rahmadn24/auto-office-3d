#!/usr/bin/env node
/**
 * Benchmark kandidat model LLM (PRD v3.0 §2.2 — model veto).
 *
 * Menjalankan `src/benchRun.ts` sekali per kandidat (env terpisah) lalu
 * mengagregasi pass rate; gate keputusan: >= 80% task lolos.
 *
 *   node scripts/bench-llm.mjs            # kandidat live (butuh token 9router)
 *   node scripts/bench-llm.mjs --stub     # validasi harness offline (driver stub)
 *   node scripts/bench-llm.mjs --model deepseek-v4.1-flash --tasks 1
 *
 * Kandidat bisa di-override lewat env BENCH_CANDIDATES (JSON array):
 *   BENCH_CANDIDATES='[{"id":"x","model":"provider/x","baseUrl":"http://localhost:20128/v1"}]'
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const brainDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const flagValue = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const useStub = hasFlag('--stub');
const onlyModel = flagValue('--model', null);
const taskCount = flagValue('--tasks', '3');

/** Tier gratis/termurah dulu — naik tier hanya bila pass rate < 80%. */
const DEFAULT_CANDIDATES = [
  {
    id: 'oc-deepseek-v4.1-flash',
    label: 'DeepSeek 4.1 Flash free (9router · Dev)',
    model: 'oc/deepseek-v4.1-flash-free',
    baseUrl: process.env.OPENAI_COMPAT_BASE_URL ?? 'http://127.0.0.1:20128/v1',
    apiKeyEnv: 'OPENAI_COMPAT_API_KEY',
  },
  {
    id: 'oc-glm-5.3-flash',
    label: 'GLM 5.3 Flash free (9router · PM)',
    model: 'oc/glm-5.3-flash-free',
    baseUrl: process.env.OPENAI_COMPAT_BASE_URL ?? 'http://127.0.0.1:20128/v1',
    apiKeyEnv: 'OPENAI_COMPAT_API_KEY',
  },
  {
    id: 'oc-mimo-v2.6-flash',
    label: 'MiMo 2.6 Flash free (9router · CS)',
    model: 'oc/mimo-v2.6-flash-free',
    baseUrl: process.env.OPENAI_COMPAT_BASE_URL ?? 'http://127.0.0.1:20128/v1',
    apiKeyEnv: 'OPENAI_COMPAT_API_KEY',
  },
];

const candidates = process.env.BENCH_CANDIDATES
  ? JSON.parse(process.env.BENCH_CANDIDATES)
  : DEFAULT_CANDIDATES;

function parseBenchResult(stdout) {
  const line = stdout
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('BENCH_RESULT:'));
  if (!line) return null;
  return JSON.parse(line.slice('BENCH_RESULT:'.length));
}

const selected = candidates.filter((c) => !onlyModel || c.id === onlyModel);
if (selected.length === 0) {
  console.error(`[bench] tidak ada kandidat cocok dengan --model ${onlyModel}`);
  process.exit(1);
}

console.log('┌──────────────────────────────────────────────────────────────┐');
console.log('│  AutoOffice3D · BENCH-LLM — evaluasi model (gate ≥ 80%)      │');
console.log('└──────────────────────────────────────────────────────────────┘');
if (useStub) console.log('  mode         stub (validasi harness offline)\n');

const results = [];
for (const candidate of selected) {
  const apiKey = useStub
    ? 'stub'
    : (process.env[candidate.apiKeyEnv ?? 'OPENAI_COMPAT_API_KEY'] ??
      process.env.ROUTER_TOKEN ??
      '');

  if (!useStub && !apiKey) {
    console.log(
      `  ⏭  ${candidate.id}: skip — isi ${candidate.apiKeyEnv ?? 'OPENAI_COMPAT_API_KEY'} (token 9router) untuk menjalankan`,
    );
    results.push({ id: candidate.id, skipped: 'missing api key' });
    continue;
  }

  const env = {
    ...process.env,
    LLM_DRIVER: useStub ? 'stub' : 'openai-compat',
    OPENAI_COMPAT_MODEL: useStub ? 'stub-deterministic' : candidate.model,
    OPENAI_COMPAT_BASE_URL: candidate.baseUrl ?? 'http://127.0.0.1:20128/v1',
    OPENAI_COMPAT_API_KEY: apiKey,
    MEMORY_DRIVER: 'memory',
    SANDBOX_DRIVER: 'local',
    BENCH_TASKS: String(taskCount),
  };

  console.log(`  ▶  ${candidate.label ?? candidate.id} (${candidate.model ?? 'stub'})`);
  const proc = spawnSync(process.execPath, ['--import', 'tsx', 'src/benchRun.ts'], {
    cwd: brainDir,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (proc.stdout) process.stdout.write(proc.stdout);
  if (proc.stderr) process.stderr.write(proc.stderr);

  const summary = parseBenchResult(proc.stdout ?? '');
  if (!summary) {
    console.error(`  ✖  ${candidate.id}: harness gagal (exit ${proc.status})`);
    results.push({ id: candidate.id, error: `exit ${proc.status}` });
    continue;
  }
  results.push({ id: candidate.id, ...summary });
  console.log('');
}

const benchable = results.filter((r) => !r.skipped && !r.error);
const report = {
  ranAt: new Date().toISOString(),
  mode: useStub ? 'stub' : 'live',
  taskCount: Number(taskCount),
  results,
};

const outDir = join(brainDir, 'bench');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `results-${Date.now()}.json`);
writeFileSync(outFile, JSON.stringify(report, null, 2));

console.log('──────────────────────────── VERDICT ────────────────────────────');
for (const r of results) {
  if (r.skipped) {
    console.log(`  ${r.id.padEnd(24)} SKIP (${r.skipped})`);
  } else if (r.error) {
    console.log(`  ${r.id.padEnd(24)} ERROR (${r.error})`);
  } else {
    const pct = Math.round(r.passRate * 100);
    console.log(
      `  ${r.id.padEnd(24)} ${r.passed}/${r.total} (${pct}%) → ${r.pass ? 'LULUS ✓' : 'GAGAL ✗ (naik tier)'}`,
    );
  }
}
console.log(`  laporan      ${outFile}`);
console.log('─────────────────────────────────────────────────────────────────');

if (benchable.length === 0 && !useStub) {
  console.log('\n  Tidak ada kandidat yang bisa dijalankan — set token 9router dulu,');
  console.log('  atau validasi harness dengan:  npm run bench:stub');
}
