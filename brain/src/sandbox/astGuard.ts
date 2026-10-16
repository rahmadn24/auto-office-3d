import ts from 'typescript';

import type { GuardViolation } from './guard';

/**
 * Guard berbasis AST sungguhan (TypeScript Compiler API) — PRD §6.3.
 * Menangkap pola yang lolos regex, mis. `process['env']`, alias `const p = process`,
 * dan modul node:fs yang di-import dengan quote berbeda.
 */

const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
const CHILD_MODULES = new Set(['child_process', 'node:child_process']);
const NET_CALLERS = new Set(['fetch', 'axios', 'EventSource', 'WebSocket']);
const PROCESS_MUTATORS = new Set(['exit', 'kill', 'binding', 'mainModule', 'dlopen']);
const SHELL_CALLERS = new Set(['exec', 'execSync', 'spawn', 'spawnSync']);

function isIdentifierNamed(node: ts.Node | undefined, name: string): boolean {
  return !!node && ts.isIdentifier(node) && node.text === name;
}

function isProcessEnvNode(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return isIdentifierNamed(node.expression, 'process') && node.name.text === 'env';
  }
  if (ts.isElementAccessExpression(node)) {
    const arg = node.argumentExpression;
    const literal = arg && ts.isStringLiteralLike(arg) ? arg.text : undefined;
    return isIdentifierNamed(node.expression, 'process') && literal === 'env';
  }
  return false;
}

function isStringArgument(
  node: ts.CallExpression | ts.NewExpression,
  index = 0,
): string | undefined {
  const arg = node.arguments?.[index];
  if (!arg) return undefined;
  if (ts.isStringLiteralLike(arg)) return arg.text;
  if (ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  return undefined;
}

function excerpt(source: ts.SourceFile, node: ts.Node): string {
  const start = node.getStart(source, false);
  const text = source.text.slice(start, node.getEnd()).replace(/\s+/g, ' ').trim();
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

export function astViolations(file: string, content: string): GuardViolation[] {
  const violations: GuardViolation[] = [];
  let source: ts.SourceFile;
  try {
    source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  } catch {
    return violations;
  }

  const push = (rule: string, node: ts.Node): void => {
    violations.push({ rule, file, excerpt: excerpt(source, node) });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (spec && ts.isStringLiteralLike(spec)) {
        if (FS_MODULES.has(spec.text)) push('filesystem-module', node);
        else if (CHILD_MODULES.has(spec.text)) push('child-process', node);
      }
    }

    if (ts.isPropertyAccessExpression(node)) {
      if (isProcessEnvNode(node)) push('host-env-access', node);
      else if (
        isIdentifierNamed(node.expression, 'process') &&
        PROCESS_MUTATORS.has(node.name.text)
      ) {
        push('host-process-control', node);
      }
    }

    if (ts.isElementAccessExpression(node) && isProcessEnvNode(node)) {
      push('host-env-access', node);
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (isIdentifierNamed(callee, 'eval')) push('dynamic-code', node);
      if (isIdentifierNamed(callee, 'Function')) push('dynamic-code', node);
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isIdentifierNamed(callee, 'require') || isDynamicImport) {
        const spec = isStringArgument(node);
        if (spec && FS_MODULES.has(spec)) push('filesystem-module', node);
        if (spec && CHILD_MODULES.has(spec)) push('child-process', node);
      }
      if (ts.isIdentifier(callee) && SHELL_CALLERS.has(callee.text)) push('child-process', node);

      const url = isStringArgument(node);
      if (
        NET_CALLERS.has(ts.isIdentifier(callee) ? callee.text : '') &&
        typeof url === 'string' &&
        /^https?:\/\//.test(url)
      ) {
        push('network-egress', node);
      }
    }

    if (ts.isNewExpression(node)) {
      if (isIdentifierNamed(node.expression, 'Function')) push('dynamic-code', node);
    }

    if (ts.isStringLiteralLike(node)) {
      if (node.text === '__proto__') push('prototype-pollution', node);
      if (node.text === 'constructor' && node.parent && ts.isElementAccessExpression(node.parent)) {
        push('prototype-pollution', node.parent);
      }
      if (/BEGIN [A-Z ]*PRIVATE KEY|id_rsa|\.aws\/credentials|\.ssh\/id_/.test(node.text)) {
        push('secret-exfiltration', node);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return violations;
}
