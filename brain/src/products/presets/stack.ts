import { widgetSnippet } from '../../cs/widget';
import type { PresetRenderInput, ProductPresetId, RenderedPresetStack } from './types';

/**
 * Renderer bersama tiga preset tier-1 (PRD §7 Fase 10).
 *
 * Hasil render = aplikasi Node tanpa dependency (hanya `node:http`) sehingga
 * image demo kecil, deterministik, dan bisa diuji tanpa jaringan:
 *   - `app.mjs`       — halaman + route JSON + factory HTTP server
 *   - `server.mjs`    — entrypoint container (PORT dari env)
 *   - `selftest.mjs`  — gate build: boot di port ephemeral, probe semua route
 *   - `Dockerfile`    — template per preset (gate dieksekusi sebagai RUN)
 */
export interface DemoMeta {
  project: string;
  slug: string;
  preset: ProductPresetId;
  tagline: string;
  pricing: string;
  runId: string;
  generatedBy: 'AutoOffice3D';
  /** Widget channel CS (Fase 11) — disisipkan pageShell di halaman produk. */
  widget?: { url: string; socketPath?: string };
}

export interface StackSpec {
  preset: ProductPresetId;
  port: number;
  healthPath: string;
  /** Gate yang dijalankan saat image dibuild (harus exit 0). */
  gate: string;
  dockerfile: string;
  page(meta: DemoMeta): string;
  /** Body JSON statis per path — `/health` ditangani otomatis oleh app.mjs. */
  routes(meta: DemoMeta): Record<string, unknown>;
  /** Berkas tambahan (mis. package.json untuk tier-1 npm install). */
  extraFiles?(meta: DemoMeta): Record<string, string>;
}

export function metaFor(input: PresetRenderInput, preset: ProductPresetId): DemoMeta {
  return {
    project: input.projectName,
    slug: input.slug,
    preset,
    tagline: input.tagline?.trim() || 'Autonomous micro-SaaS shipped by AutoOffice3D',
    pricing: input.pricing?.trim() || '$29/mo',
    runId: input.runId ?? 'demo',
    generatedBy: 'AutoOffice3D',
    ...(input.widget ? { widget: input.widget } : {}),
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #051424; color: #e2e8f0;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 48px 24px 32px; }
  .eyebrow { font: 600 11px/1.4 ui-monospace, monospace; letter-spacing: .18em;
    text-transform: uppercase; color: ACCENT; margin: 0 0 12px; }
  h1 { margin: 0 0 12px; font-size: clamp(34px, 6vw, 56px); line-height: 1.05; }
  .tagline { margin: 0 0 28px; font-size: 17px; color: #94a3b8; max-width: 640px; }
  .card { border: 1px solid rgba(148, 163, 184, .2); border-radius: 14px;
    background: rgba(15, 32, 51, .72); padding: 20px; }
  .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
  .price { font: 700 34px/1.1 ui-monospace, monospace; color: #f8fafc; }
  .muted { color: #94a3b8; font-size: 13px; }
  .cta { display: inline-block; margin-top: 16px; padding: 10px 18px; border-radius: 999px;
    background: ACCENT; color: #051424; font-weight: 700; text-decoration: none; }
  h2 { font: 600 12px/1.4 ui-monospace, monospace; letter-spacing: .14em;
    text-transform: uppercase; color: #94a3b8; margin: 32px 0 12px; }
  table { width: 100%; border-collapse: collapse; font: 12px/1.6 ui-monospace, monospace; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid rgba(148, 163, 184, .14); }
  th { color: #64748b; font-weight: 500; }
  code, pre { font-family: ui-monospace, monospace; }
  pre { margin: 0; padding: 14px; border-radius: 10px; background: rgba(2, 6, 23, .65);
    color: #7dd3fc; font-size: 12px; overflow-x: auto; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font: 600 11px/1.6
    ui-monospace, monospace; border: 1px solid ACCENT; color: ACCENT; }
  ul.plain { list-style: none; margin: 0; padding: 0; font: 12px/2 ui-monospace, monospace;
    color: #94a3b8; }
  .layout { display: grid; gap: 18px; grid-template-columns: 190px minmax(0, 1fr); align-items: start; }
  @media (max-width: 720px) { .layout { grid-template-columns: 1fr; } }
  footer { max-width: 960px; margin: 0 auto; padding: 18px 24px 42px;
    color: #475569; font: 11px/1.6 ui-monospace, monospace; }
`.trim();

/** Kerangka halaman demo — warna aksen mengikuti preset. */
export function pageShell(meta: DemoMeta, accent: string, body: string): string {
  const style = STYLE.replaceAll('ACCENT', accent);
  const widget = meta.widget
    ? widgetSnippet(meta.widget.url, meta.widget.socketPath ?? '/brain-server')
    : '';
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="generator" content="AutoOffice3D" />',
    `<title>${escapeHtml(meta.project)} · ${escapeHtml(meta.preset)}</title>`,
    `<style>${style}</style>`,
    '</head>',
    `<body data-preset="${escapeHtml(meta.preset)}" data-slug="${escapeHtml(meta.slug)}">`,
    '<main>',
    body,
    '</main>',
    `<footer>Generated autonomously by AutoOffice3D · preset ${escapeHtml(meta.preset)} · run ${escapeHtml(meta.runId)}</footer>`,
    ...(widget ? [widget] : []),
    '</body>',
    '</html>',
  ].join('\n');
}

/** Template Dockerfile per preset — gate preset dieksekusi sebagai RUN build-time. */
export function dockerfileFor(input: {
  preset: ProductPresetId;
  port: number;
  gate: string;
  multiStage?: boolean;
}): string {
  const healthcheck =
    'HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=5 ' +
    `CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || ${input.port}) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"`;
  const runtime = [
    'ENV NODE_ENV=production',
    `ENV PORT=${input.port}`,
    `RUN ${input.gate}`,
    `EXPOSE ${input.port}`,
    healthcheck,
    'CMD ["node", "server.mjs"]',
  ];
  const header = `# AutoOffice3D preset stack: ${input.preset} (tier-1 TypeScript/Node)`;
  const lines = input.multiStage
    ? [
        header,
        'FROM node:22-alpine AS deps',
        'WORKDIR /app',
        'COPY package.json ./',
        'RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund --offline',
        'RUN mkdir -p node_modules',
        '',
        'FROM node:22-alpine',
        'WORKDIR /app',
        'COPY --from=deps /app/node_modules ./node_modules',
        'COPY . .',
        ...runtime,
      ]
    : [header, 'FROM node:22-alpine', 'WORKDIR /app', 'COPY . .', ...runtime];
  return [...lines, ''].join('\n');
}

/** Susun seluruh berkas produk untuk satu preset. */
export function renderStack(spec: StackSpec, input: PresetRenderInput): RenderedPresetStack {
  const meta = metaFor(input, spec.preset);
  const routes = spec.routes(meta);
  const page = spec.page(meta);

  const appSource = [
    "import { createServer } from 'node:http';",
    '',
    `export const META = ${JSON.stringify(meta, null, 2)};`,
    '',
    `const PAGE = ${JSON.stringify(page)};`,
    '',
    `const ROUTES = ${JSON.stringify(routes, null, 2)};`,
    '',
    'export function createApp() {',
    '  return createServer((req, res) => {',
    "    const url = new URL(req.url ?? '/', 'http://localhost');",
    "    if (url.pathname === '/' || url.pathname === '/index.html') {",
    "      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });",
    '      res.end(PAGE);',
    '      return;',
    '    }',
    `    if (url.pathname === ${JSON.stringify(spec.healthPath)}) {`,
    '      res.writeHead(200, {',
    "        'content-type': 'application/json; charset=utf-8',",
    "        'cache-control': 'no-store',",
    '      });',
    '      res.end(',
    '        JSON.stringify({',
    '          ok: true,',
    '          preset: META.preset,',
    '          slug: META.slug,',
    '          uptimeS: Math.round(process.uptime()),',
    '          generatedBy: META.generatedBy,',
    '        }),',
    '      );',
    '      return;',
    '    }',
    '    const route = ROUTES[url.pathname];',
    '    if (route !== undefined) {',
    "      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });",
    '      res.end(JSON.stringify(route));',
    '      return;',
    '    }',
    "    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });",
    "    res.end(JSON.stringify({ error: 'not found', path: url.pathname }));",
    '  });',
    '}',
    '',
  ].join('\n');

  const serverSource = [
    "import { createApp, META } from './app.mjs';",
    '',
    `const port = Number(process.env.PORT || ${spec.port});`,
    "createApp().listen(port, '0.0.0.0', () => {",
    "  console.log('[demo] ' + META.slug + ' (' + META.preset + ') listening on port ' + port);",
    '});',
    '',
  ].join('\n');

  const checks = ['/', spec.healthPath, ...Object.keys(routes)];
  const selftestSource = [
    "import { createApp, META } from './app.mjs';",
    '',
    'const server = createApp();',
    "await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));",
    'const address = server.address();',
    "const base = 'http://127.0.0.1:' + address.port;",
    `const CHECKS = ${JSON.stringify(checks)};`,
    '',
    'let failed = 0;',
    'for (const path of CHECKS) {',
    '  const res = await fetch(base + path);',
    '  const text = await res.text();',
    '  let ok = res.status === 200;',
    "  if (ok && path === '/') ok = text.includes(META.slug) && text.includes(META.project);",
    "  if (ok && path !== '/') {",
    '    try {',
    '      const body = JSON.parse(text);',
    '      ok = Boolean(body) && body.ok !== false;',
    '    } catch {',
    '      ok = false;',
    '    }',
    '  }',
    "  console.log((ok ? 'ok   ' : 'FAIL ') + path);",
    '  if (!ok) failed += 1;',
    '}',
    'server.close();',
    'if (failed > 0) {',
    "  console.error('selftest failed: ' + failed + '/' + CHECKS.length);",
    '  process.exit(1);',
    '}',
    "console.log('selftest OK: ' + CHECKS.length + ' checks · preset ' + META.preset);",
    '',
  ].join('\n');

  const readme = [
    `# ${meta.project} — demo (${meta.preset})`,
    '',
    `Generated autonomously by ${meta.generatedBy} · run \`${meta.runId}\`.`,
    '',
    `- Preset stack: **${meta.preset}** (tier-1: TypeScript/Node)`,
    `- Health check: \`${spec.healthPath}\``,
    `- Port container: \`${spec.port}\``,
    `- Build gate: \`${spec.gate}\``,
    '',
    'Jalankan lokal tanpa Docker:',
    '',
    '```bash',
    'node selftest.mjs   # gate yang sama dengan image build',
    'PORT=' + spec.port + ' node server.mjs',
    '```',
    '',
    'Atau lewat image (dibangun oleh DEPLOY_DRIVER=docker):',
    '',
    '```bash',
    `docker build -t ao3d-demo-${meta.slug} .`,
    `docker run --rm -p 127.0.0.1:${spec.port}:${spec.port} ao3d-demo-${meta.slug}`,
    '```',
    '',
  ].join('\n');

  return {
    preset: spec.preset,
    port: spec.port,
    healthPath: spec.healthPath,
    gate: spec.gate,
    dockerfile: spec.dockerfile,
    files: {
      'app.mjs': appSource,
      'server.mjs': serverSource,
      'selftest.mjs': selftestSource,
      'README.md': readme,
      Dockerfile: spec.dockerfile,
      ...spec.extraFiles?.(meta),
    },
  };
}
