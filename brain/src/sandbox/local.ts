import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { formatViolations, validateFiles } from './guard';
import { COVERAGE_THRESHOLD } from './types';
import type {
  CoverageReport,
  SandboxDriver,
  SandboxRequest,
  SandboxResult,
  TestReport,
} from './types';

const require = createRequire(import.meta.url);
/** Dir `node_modules` milik brain — dipakai sebagai isi sandbox lewat symlink. */
const NODE_MODULES_DIR = path.resolve(
  path.dirname(require.resolve('typescript/package.json')),
  '..',
);

interface ExecOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

function resolveBin(pkg: string, binName: string): string {
  const pkgDir = path.dirname(require.resolve(`${pkg}/package.json`));
  const manifest = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
  if (!entry) throw new Error(`Cannot resolve bin "${binName}" of package "${pkg}"`);
  return path.join(pkgDir, entry);
}

function exec(nodeArgs: string[], cwd: string, timeoutMs: number): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, nodeArgs, {
      cwd,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: cwd,
        TMPDIR: cwd,
        NODE_ENV: 'test',
        CI: '1',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        code: 127,
        stdout,
        stderr: `${stderr}\n${err.message}`,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, durationMs: Date.now() - started });
    });
  });
}

function parseVitestReport(out: string, fallbackDuration: number): TestReport {
  const testsLine = /^\s*Tests\s+(.+)$/m.exec(out)?.[1] ?? '';
  const passed = Number(/(\d+)\s+passed/.exec(testsLine)?.[1] ?? 0);
  const failed = Number(/(\d+)\s+failed/.exec(testsLine)?.[1] ?? 0);
  const skipped = Number(/(\d+)\s+skipped/.exec(testsLine)?.[1] ?? 0);
  const totalMatch = /\((\d+)\)/.exec(testsLine);
  const total = totalMatch ? Number(totalMatch[1]) : passed + failed + skipped;
  const duration = Number(/\((\d+)ms\)/.exec(out)?.[1] ?? fallbackDuration);
  const report: TestReport = { total, passed, failed, durationMs: duration };
  const coverage = parseCoverage(out);
  if (coverage) report.coverage = coverage;
  return report;
}

/** Kontohasil vitest: blok `Coverage summary`, tabel reporter teks (baris `All files`), atau baris tunggal. */
function parseCoverage(out: string): CoverageReport | undefined {
  const pick = (name: string): number | undefined => {
    const match = new RegExp(`${name}\\s*:\\s*([\\d.]+)%`, 'i').exec(out);
    return match ? Number(match[1]) : undefined;
  };

  if (/Coverage summary/.test(out)) {
    const statements = pick('Statements');
    const branches = pick('Branches');
    const functions = pick('Functions');
    const lines = pick('Lines');
    if (
      statements !== undefined &&
      branches !== undefined &&
      functions !== undefined &&
      lines !== undefined
    ) {
      return { statements, branches, functions, lines };
    }
  }

  // Tabel reporter teks: `All files | 100 | 96 | 100 | 100 |`
  const table = /^All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/m.exec(
    out,
  );
  if (table) {
    return {
      statements: Number(table[1]),
      branches: Number(table[2]),
      functions: Number(table[3]),
      lines: Number(table[4]),
    };
  }

  const line =
    /Coverage:\s*([\d.]+)%\s+Statements[^|]*\|\s*([\d.]+)%\s+Branches[^|]*\|\s*([\d.]+)%\s+Functions[^|]*\|\s*([\d.]+)%\s+Lines/i.exec(
      out,
    );
  if (!line) return undefined;
  return {
    statements: Number(line[1]),
    branches: Number(line[2]),
    functions: Number(line[3]),
    lines: Number(line[4]),
  };
}

const SANDBOX_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2023'],
    module: 'ESNext',
    moduleResolution: 'Bundler',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    types: ['node'],
  },
  include: ['src/**/*.ts', 'tests/**/*.ts'],
};

/**
 * Driver offline: eksekusi `tsc --noEmit` + `vitest run` di direktori temp terisolasi.
 *
 * Kepatuhan PRD §6.1:
 *  - Node child process dibuat dengan env MINIMAL (hanya PATH) — rahasia host tidak bocor.
 *  - cwd dipindah ke tmp dir, tidak pernah ke repo/OS host.
 *  - Timeout keras (default 60s) → SIGKILL.
 *  - Guard PRD §6.3 berjalan SEBELUM file ditulis.
 */
export class LocalSandbox implements SandboxDriver {
  readonly driver = 'local';

  constructor(
    private readonly defaultTimeoutMs = 60_000,
    private readonly keepArtifacts = false,
  ) {}

  async run(request: SandboxRequest): Promise<SandboxResult> {
    const started = Date.now();
    const guard = validateFiles(request.files);
    if (!guard.ok) {
      return {
        ok: false,
        driver: this.driver,
        typeCheck: { ok: false, errors: ['rejected by security guard'] },
        tests: { total: 0, passed: 0, failed: 0, durationMs: 0 },
        logs: `SECURITY_REJECTED\n${formatViolations(guard)}`,
        durationMs: Date.now() - started,
        rejectedBy: 'prompt-injection-guard',
      };
    }

    const dir = await mkdtemp(path.join(os.tmpdir(), 'autooffice3d-'));
    try {
      await this.materialize(dir, request.files);

      const tscBin = resolveBin('typescript', 'tsc');
      const vitestBin = resolveBin('vitest', 'vitest');
      const timeout = request.timeoutMs || this.defaultTimeoutMs;

      const typecheck = await exec(
        [tscBin, '--noEmit', '--pretty', 'false', '-p', dir],
        dir,
        timeout,
      );
      const typeErrors = `${typecheck.stdout}\n${typecheck.stderr}`
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !/^\s*$/.test(l) && !l.startsWith(dir))
        .filter((l) => !/Found \d+ error/.test(l))
        .slice(0, 50);

      const vitestArgs = ['run'];
      if (request.coverage) vitestArgs.push('--coverage');
      const tests = await exec([vitestBin, ...vitestArgs], dir, timeout);
      const output = `${tests.stdout}\n${tests.stderr}`;
      const report = parseVitestReport(output, tests.durationMs);

      const timedOut = typecheck.timedOut || tests.timedOut;
      const typeOk = typecheck.code === 0;
      const testsOk = tests.code === 0 && report.failed === 0 && report.total > 0;
      const coverageOk = !report.coverage || report.coverage.statements >= COVERAGE_THRESHOLD;

      return {
        ok: typeOk && testsOk && coverageOk && !timedOut,
        driver: this.driver,
        typeCheck: { ok: typeOk, errors: typeErrors },
        tests: report,
        logs: [
          timedOut ? `TIMEOUT after ${timeout}ms — process killed` : '',
          `tsc --noEmit → exit ${typecheck.code}`,
          report.coverage
            ? `Coverage: ${report.coverage.statements}% Statements | ${report.coverage.branches}% Branches | ${report.coverage.functions}% Functions | ${report.coverage.lines}% Lines`
            : '',
          output.trim(),
        ]
          .filter(Boolean)
          .join('\n')
          .slice(0, 20_000),
        durationMs: Date.now() - started,
      };
    } finally {
      if (!this.keepArtifacts) await rm(dir, { recursive: true, force: true });
    }
  }

  private async materialize(dir: string, files: Record<string, string>): Promise<void> {
    for (const [rel, content] of Object.entries(files)) {
      const target = path.join(dir, rel);
      if (!target.startsWith(dir + path.sep))
        throw new Error(`Refusing to write outside sandbox: ${rel}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }

    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
    await writeFile(path.join(dir, 'tsconfig.json'), JSON.stringify(SANDBOX_TSCONFIG, null, 2));

    // Node modules di-link dari brain agar vitest & typescript tersedia tanpa npm install.
    await symlink(NODE_MODULES_DIR, path.join(dir, 'node_modules'), 'dir').catch(() => undefined);
  }
}
