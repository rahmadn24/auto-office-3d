import { dockerfileFor, escapeHtml, pageShell, renderStack, type DemoMeta } from './stack';
import type { PresetRenderInput, ProductPreset, RenderedPresetStack } from './types';

const PORT = 4173;
const HEALTH_PATH = '/health';
const GATE = 'node --check server.mjs && node selftest.mjs';

function page(meta: DemoMeta): string {
  const body = [
    '<p class="eyebrow">Autonomous demo · landing</p>',
    `<h1>${escapeHtml(meta.project)}</h1>`,
    `<p class="tagline">${escapeHtml(meta.tagline)}</p>`,
    '<div class="grid">',
    '<div class="card">',
    '<span class="pill">Launch price</span>',
    `<p class="price">${escapeHtml(meta.pricing)}</p>`,
    '<p class="muted">The first cohort locks this price for life.</p>',
    '<a class="cta" href="#checkout">Start checkout</a>',
    '</div>',
    '<div class="card">',
    '<h2 style="margin-top:0">Shipped end-to-end</h2>',
    '<ul class="plain">',
    '<li>· Spec → code → QA in one autonomous run</li>',
    '<li>· Built from the codegen bundle inside a demo container</li>',
    '<li>· Health-checked before the office reports READY</li>',
    '</ul>',
    '</div>',
    '</div>',
    '<h2>How this page exists</h2>',
    '<div class="card"><p class="muted">A single founder directive was turned into this product by the agent team (PM → Dev → QA → DevOps → Growth): specification, typed source, deterministic tests, a container build gate, and a live health endpoint.</p></div>',
  ].join('\n');
  return pageShell(meta, '#38bdf8', body);
}

/** Preset `landing`: satu halaman marketing + CTA checkout, tanpa dependency. */
export const landingPreset: ProductPreset = {
  id: 'landing',
  label: 'Landing',
  description: 'Halaman marketing tunggal + CTA checkout (statis, node:http).',
  tier1: 'TypeScript/Node tanpa dependency runtime (node:http saja).',
  port: PORT,
  healthPath: HEALTH_PATH,
  keywords: ['landing', 'waitlist', 'marketing page'],
  render(input: PresetRenderInput): RenderedPresetStack {
    return renderStack(
      {
        preset: 'landing',
        port: PORT,
        healthPath: HEALTH_PATH,
        gate: GATE,
        dockerfile: dockerfileFor({ preset: 'landing', port: PORT, gate: GATE }),
        page,
        routes: () => ({}),
      },
      input,
    );
  },
};
