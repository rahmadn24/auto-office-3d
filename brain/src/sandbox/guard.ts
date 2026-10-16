/**
 * Prompt-injection & code-poisoning guard — PRD §6.3.
 * Validasi AST/statistik statis ATAS kode sebelum dieksekusi di sandbox:
 * menolak pembacaan filesystem lokal, akses env var host, dan egress jaringan.
 */

export interface GuardViolation {
  rule: string;
  file: string;
  excerpt: string;
}

export interface GuardResult {
  ok: boolean;
  violations: GuardViolation[];
}

interface Rule {
  name: string;
  re: RegExp;
}

const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

const RULES: Rule[] = [
  { name: 'host-env-access', re: /process\s*\.\s*env/ },
  { name: 'host-process-control', re: /process\s*\.\s*(?:exit|kill|binding|mainModule|dlopen)/ },
  {
    name: 'filesystem-module',
    re: /require\(\s*['"](?:node:)?(?:fs|fs\/promises)['"]|from\s*['"](?:node:)?(?:fs|fs\/promises)['"]|import\(\s*['"](?:node:)?(?:fs|fs\/promises)['"]/,
  },
  {
    name: 'child-process',
    re: /child_process|require\(\s*['"]node:child_process|from\s*['"]node:child_process|\bexecSync\s*\(|\bspawnSync\s*\(/,
  },
  { name: 'network-egress', re: /\b(?:fetch|axios|EventSource|WebSocket)\s*\(\s*['"`]https?:\/\// },
  { name: 'dynamic-code', re: /\beval\s*\(|new\s+Function\s*\(/ },
  { name: 'prototype-pollution', re: /__proto__[\s\]]|constructor\s*\[\s*['"]prototype['"]\s*\]/ },
  { name: 'secret-exfiltration', re: /BEGIN [A-Z ]*PRIVATE KEY|id_rsa|\.aws\/credentials|\.ssh\/id_/ },
  { name: 'shell-out', re: /\bexeca\b|\bshell:\s*true\b|\bspawn\s*\(/ },
];

const MAX_EXCERPT = 120;

function excerptAt(source: string, index: number): string {
  const from = Math.max(0, index - 40);
  return source.slice(from, index + MAX_EXCERPT).replace(/\s+/g, ' ').trim();
}

/** Menolak path traversal / absolut sebelum file ditulis ke sandbox. */
export function validatePaths(files: Record<string, string>): GuardViolation[] {
  const violations: GuardViolation[] = [];
  for (const path of Object.keys(files)) {
    const normalized = path.replace(/\\/g, '/');
    const bad =
      normalized.startsWith('/') ||
      /^[a-zA-Z]:/.test(normalized) ||
      normalized.split('/').some((seg) => seg === '..');
    if (bad) {
      violations.push({ rule: 'path-traversal', file: path, excerpt: 'unsafe file path rejected' });
    }
  }
  return violations;
}

export function validateFiles(files: Record<string, string>): GuardResult {
  const violations: GuardViolation[] = validatePaths(files);

  for (const [path, content] of Object.entries(files)) {
    if (!CODE_EXT.test(path)) continue;
    for (const rule of RULES) {
      const match = rule.re.exec(content);
      if (match && match.index !== undefined) {
        violations.push({ rule: rule.name, file: path, excerpt: excerptAt(content, match.index) });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

export function formatViolations(result: GuardResult): string {
  return result.violations.map((v) => `${v.file} :: ${v.rule} :: ${v.excerpt}`).join('\n');
}
