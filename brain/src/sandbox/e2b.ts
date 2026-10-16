import type { SandboxDriver, SandboxRequest, SandboxResult } from './types';

interface E2BSandboxLike {
  files: { write(path: string, data: string): Promise<unknown>; makeDir(path: string): Promise<unknown> };
  commands: {
    run(
      cmd: string,
      opts?: { cwd?: string; timeout?: number },
    ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
  kill(): Promise<unknown>;
}

/**
 * Driver produksi: E2B isolated micro-VM (PRD §2.1 & §6.1).
 *
 * Package `e2b` adalah OPTIONAL dependency (berat, butuh API key) sehingga tidak
 * dipasang default — driver ini hanya diaktifkan lewat SANDBOX_DRIVER=e2b.
 */
export class E2BSandbox implements SandboxDriver {
  readonly driver = 'e2b';

  constructor(private readonly apiKey: string) {}

  async run(request: SandboxRequest): Promise<SandboxResult> {
    const started = Date.now();

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
        if (segments.length > 0) await sandbox.files.makeDir(`/home/user/${segments.join('/')}`);
        await sandbox.files.write(`/home/user/${rel}`, content);
      }

      const typecheck = await sandbox.commands.run('npx --yes tsc --noEmit -p /home/user', {
        cwd: '/home/user',
        timeout: request.timeoutMs,
      });
      const tests = await sandbox.commands.run('npx --yes vitest run', {
        cwd: '/home/user',
        timeout: request.timeoutMs,
      });

      const passed = /(\d+)\s+passed/.exec(tests.stdout)?.[1];
      const failed = /(\d+)\s+failed/.exec(tests.stdout)?.[1];

      return {
        ok: typecheck.exitCode === 0 && tests.exitCode === 0,
        driver: this.driver,
        typeCheck: {
          ok: typecheck.exitCode === 0,
          errors: typecheck.stdout.split('\n').filter(Boolean).slice(0, 50),
        },
        tests: {
          total: (Number(passed ?? 0) || 0) + (Number(failed ?? 0) || 0),
          passed: Number(passed ?? 0) || 0,
          failed: Number(failed ?? 0) || 0,
          durationMs: 0,
        },
        logs: `${typecheck.stdout}${tests.stdout}${tests.stderr}`.slice(0, 20_000),
        durationMs: Date.now() - started,
      };
    } finally {
      await sandbox.kill().catch(() => undefined);
    }
  }
}
