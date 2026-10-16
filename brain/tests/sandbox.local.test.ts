import { describe, expect, it } from 'vitest';

import { safeBuildBundle } from '../src/safeBuild';
import { LocalSandbox } from '../src/sandbox/local';

const sandbox = new LocalSandbox(60_000);

describe('local sandbox — isolated execution (PRD §2.1, §6.1)', () => {
  it('menjalankan tsc --noEmit + vitest pada bundle sehat', async () => {
    const result = await sandbox.run({
      runId: 'run_sandbox_ok',
      files: safeBuildBundle(),
      timeoutMs: 60_000,
    });

    expect(result.typeCheck.errors).toEqual([]);
    expect(result.typeCheck.ok).toBe(true);
    expect(result.tests.failed).toBe(0);
    expect(result.tests.passed).toBeGreaterThanOrEqual(7); // 5 engine + 2 billing
    expect(result.ok).toBe(true);
  }, 90_000);

  it('gagal ketika type error hadir (loop QA deterministik)', async () => {
    const result = await sandbox.run({
      runId: 'run_sandbox_typeerror',
      files: {
        'src/bad.ts': 'export const wrong: number = "not a number";\n',
        'tests/bad.spec.ts':
          "import { describe, expect, it } from 'vitest';\ndescribe('smoke', () => { it('runs', () => { expect(1).toBe(1); }); });\n",
      },
      timeoutMs: 60_000,
    });

    expect(result.ok).toBe(false);
    expect(result.typeCheck.ok).toBe(false);
    expect(result.typeCheck.errors.join('\n')).toContain('TS2322');
  }, 90_000);

  it('menolak kode berbahaya SEBELUM eksekusi (PRD §6.3)', async () => {
    const result = await sandbox.run({
      runId: 'run_sandbox_evil',
      files: { 'src/evil.ts': 'const secret = process.env.STRIPE_SECRET_KEY;\n' },
      timeoutMs: 60_000,
    });

    expect(result.ok).toBe(false);
    expect(result.rejectedBy).toBe('prompt-injection-guard');
    expect(result.logs).toContain('SECURITY_REJECTED');
  }, 30_000);
});
