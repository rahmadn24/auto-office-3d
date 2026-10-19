import { formatViolations, validateFiles } from './guard';
import { parseVitestReport, SANDBOX_TSCONFIG } from './local';
import { COVERAGE_THRESHOLD } from './types';
import type { SandboxDriver, SandboxRequest, SandboxResult, TestReport } from './types';

interface E2BExecOutcome {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

interface E2BSandboxLike {
  files: {
    write(path: string, data: string): Promise<unknown>;
    makeDir(path: string): Promise<unknown>;
  };
  commands: {
    run(
      cmd: string,
      opts?: { cwd?: string; timeoutMs?: number },
    ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
  kill(): Promise<unknown>;
}

const SCRATCH = '/home/user';

/**
 * Driver produksi: E2B isolated micro-VM (PRD §2.1 & §6.1).
 *
 * Package `e2b` adalah OPTIONAL dependency (berat, butuh API key) sehingga tidak
 * dipasang default — driver ini hanya diaktifkan lewat SANDBOX_DRIVER=e2b.
 *
 * Paritas dengan LocalSandbox: guard PRD §6.3 jalan sebelum file ditulis,
 * scaffold package.json/tsconfig ikut ditulis, coverage gate 90% berlaku, dan
 * exit≠0 dari SDK dinormalisasi (bukan melempar error yang mematikan run).
 */
export class E2BSandbox implements SandboxDriver {
  readonly driver = 'e2b';

  constructor(private readonly apiKey: string) {}

  /** Jalankan command; SDK bisa melempar CommandExitError saat exit ≠ 0. */
  private async exec(
    sandbox: E2BSandboxLike,
    cmd: string,
    timeoutMs: number,
  ): Promise<E2BExecOutcome> {
    const started = Date.now();
    try {
      const res = await sandbox.commands.run(cmd, { cwd: SCRATCH, timeoutMs });
      return {
        code: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        timedOut: false,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      const e = err as { exitCode?: number; stdout?: string; stderr?: string; message?: string };
      const message = e.message ?? String(err);
      return {
        code: typeof e.exitCode === 'number' ? e.exitCode : 1,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? message,
        timedOut: /timeout|timed out/i.test(message),
        durationMs: Date.now() - started,
      };
    }
  }

  async run(request: SandboxRequest): Promise<SandboxResult> {
    const started = Date.now();

    // PRD §6.3 — guard yang sama seperti LocalSandbox; e2b jangan jadi jalur bypass.
    const guard = validateFiles(request.files);
    if (!guard.ok) {
      return {
        ok: false,
        driver: this.driver,
        typeCheck: { ok: false, errors: ['rejected by security guard'] },
        tests: { total: 0, passed: 0, failed: 0, durationMs: 0 },
        logs: `SECURITY_REJECTED\n${formatViolations(guard)}`,
        rejectedBy: 'prompt-injection-guard',
        durationMs: Date.now() - started,
      };
    }

    let createSandbox: (opts: { apiKey: string }) => Promise<E2BSandboxLike>;
    try {
      // Spesifier non-literal agar tsc tidak wajib menemukan package opsional ini.
      const optionalSpecifier = ['e', '2', 'b'].join('');
      const mod = (await import(optionalSpecifier)) as unknown as {
        Sandbox: { create(opts: { apiKey: string }): Promise<E2BSandboxLike> };
      };
      createSandbox = (opts) => mod.Sandbox.create(opts);
    } catch (err) {
      throw new Error(
        `SANDBOX_DRIVER=e2b but the optional "e2b" package is not installed. ` +
          `Run "npm i e2b" in brain/ and set E2B_API_KEY. (${(err as Error).message})`,
      );
    }

    const sandbox = await createSandbox({ apiKey: this.apiKey });
    try {
      for (const [rel, content] of Object.entries(request.files)) {
        const segments = rel.split('/');
        segments.pop();
        if (segments.length > 0) await sandbox.files.makeDir(`${SCRATCH}/${segments.join('/')}`);
        await sandbox.files.write(`${SCRATCH}/${rel}`, content);
      }

      // Scaffold minimal (paritas LocalSandbox.materialize) bila agen tidak
      // menyediakannya — tanpa tsconfig, `tsc -p` langsung gagal.
      const scaffold: Record<string, string> = {
        'package.json': JSON.stringify({ type: 'module' }, null, 2),
        'tsconfig.json': JSON.stringify(SANDBOX_TSCONFIG, null, 2),
      };
      for (const [rel, content] of Object.entries(scaffold)) {
        if (!(rel in request.files)) await sandbox.files.write(`${SCRATCH}/${rel}`, content);
      }

      const timeoutMs = request.timeoutMs ?? 60_000;
      const typecheck = await this.exec(
        sandbox,
        'npx --yes tsc --noEmit --pretty false -p /home/user',
        timeoutMs,
      );
      const tests = await this.exec(
        sandbox,
        request.coverage ? 'npx --yes vitest run --coverage' : 'npx --yes vitest run',
        timeoutMs,
      );

      const output = `${tests.stdout}\n${tests.stderr}`;
      const report: TestReport = parseVitestReport(output, tests.durationMs);
      const timedOut = typecheck.timedOut || tests.timedOut;
      const typeOk = typecheck.code === 0;
      const testsOk = tests.code === 0 && report.failed === 0 && report.total > 0;
      const coverageOk = !report.coverage || report.coverage.statements >= COVERAGE_THRESHOLD;

      return {
        ok: typeOk && testsOk && coverageOk && !timedOut,
        driver: this.driver,
        typeCheck: {
          ok: typeOk,
          errors: `${typecheck.stdout}\n${typecheck.stderr}`
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && !/Found \d+ error/.test(l))
            .slice(0, 50),
        },
        tests: report,
        logs: [
          timedOut ? `TIMEOUT after ${timeoutMs}ms — process killed` : '',
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
      await sandbox.kill().catch(() => undefined);
    }
  }
}
