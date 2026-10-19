import { dockerfileFor, escapeHtml, pageShell, renderStack, type DemoMeta } from './stack';
import type { PresetRenderInput, ProductPreset, RenderedPresetStack } from './types';

const PORT = 8080;
const HEALTH_PATH = '/health';
const GATE = 'node --check server.mjs && node selftest.mjs';

function page(meta: DemoMeta): string {
  const nav = ['Workspace', 'Runs', 'Artifacts', 'Settings']
    .map((item) => `<li>· ${escapeHtml(item)}</li>`)
    .join('');
  const config = JSON.stringify(
    {
      app: meta.slug,
      preset: meta.preset,
      runId: meta.runId,
      features: ['workspace', 'artifact vault', 'audit log'],
      region: 'local-demo',
    },
    null,
    2,
  );

  const body = [
    '<p class="eyebrow">Autonomous demo · custom-app</p>',
    `<h1>${escapeHtml(meta.project)}</h1>`,
    `<p class="tagline">${escapeHtml(meta.tagline)}</p>`,
    '<div class="layout">',
    '<div class="card"><span class="pill">Navigation</span>',
    `<ul class="plain" style="margin-top:12px">${nav}</ul></div>`,
    '<div class="card">',
    '<h2 style="margin-top:0">Workspace status</h2>',
    '<ul class="plain">',
    `· Preset: ${escapeHtml(meta.preset)}`,
    `· Run: ${escapeHtml(meta.runId)}`,
    `· Health: ${escapeHtml(HEALTH_PATH)} · API: /api/config`,
    '</ul>',
    '<h2>Runtime config</h2>',
    `<pre>${escapeHtml(config)}</pre>`,
    '<a class="cta" href="#workspace">Open workspace</a>',
    '</div>',
    '</div>',
  ].join('\n');
  return pageShell(meta, '#f59e0b', body);
}

/** Preset `custom-app`: shell aplikasi internal (nav + workspace + config API). */
export const customAppPreset: ProductPreset = {
  id: 'custom-app',
  label: 'Custom App',
  description: 'Shell aplikasi internal: navigasi, workspace, dan /api/config.',
  tier1: 'TypeScript/Node tanpa dependency runtime (node:http saja).',
  port: PORT,
  healthPath: HEALTH_PATH,
  keywords: ['custom app', 'internal tool', 'portal', 'workspace'],
  render(input: PresetRenderInput): RenderedPresetStack {
    return renderStack(
      {
        preset: 'custom-app',
        port: PORT,
        healthPath: HEALTH_PATH,
        gate: GATE,
        dockerfile: dockerfileFor({ preset: 'custom-app', port: PORT, gate: GATE }),
        page,
        routes: (meta: DemoMeta) => ({
          '/api/config': {
            app: meta.slug,
            preset: meta.preset,
            features: ['workspace', 'artifact vault', 'audit log'],
            region: 'local-demo',
          },
        }),
      },
      input,
    );
  },
};
