import { dockerfileFor, escapeHtml, pageShell, renderStack, type DemoMeta } from './stack';
import type { PresetRenderInput, ProductPreset, RenderedPresetStack } from './types';

const PORT = 3000;
const HEALTH_PATH = '/health';
const GATE = 'node --check app.mjs && node --check server.mjs && node selftest.mjs';

function page(meta: DemoMeta): string {
  const rows = [
    { id: `${meta.slug}-0001`, plan: 'Starter · monthly', amount: '$29.00', status: 'paid' },
    { id: `${meta.slug}-0002`, plan: 'Starter · monthly', amount: '$29.00', status: 'paid' },
    { id: `${meta.slug}-0003`, plan: 'Starter · annual', amount: '$290.00', status: 'open' },
  ]
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.id)}</td><td>${escapeHtml(r.plan)}</td><td>${escapeHtml(r.amount)}</td><td>${escapeHtml(r.status)}</td></tr>`,
    )
    .join('');

  const body = [
    '<p class="eyebrow">Autonomous demo · saas-fullstack</p>',
    `<h1>${escapeHtml(meta.project)}</h1>`,
    `<p class="tagline">${escapeHtml(meta.tagline)}</p>`,
    '<div class="grid">',
    '<div class="card">',
    '<span class="pill">Starter plan</span>',
    `<p class="price">${escapeHtml(meta.pricing)}</p>`,
    '<p class="muted">Per seat, billed via the Payment Sentinel webhook.</p>',
    '<a class="cta" href="#checkout">Start subscription</a>',
    '</div>',
    '<div class="card">',
    '<h2 style="margin-top:0">Live API</h2>',
    '<ul class="plain">',
    '<li>· GET /api/pricing — plan &amp; anchor price</li>',
    '<li>· GET /api/invoices — demo billing ledger</li>',
    `<li>· GET ${escapeHtml(HEALTH_PATH)} — container health</li>`,
    '</ul>',
    '</div>',
    '</div>',
    '<h2>Billing ledger (demo data)</h2>',
    '<div class="card">',
    '<table><thead><tr><th>Invoice</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead>',
    `<tbody>${rows}</tbody></table>`,
    '</div>',
  ].join('\n');
  return pageShell(meta, '#4edea3', body);
}

/** Preset `saas-fullstack`: landing + API billing + Dockerfile multi-stage npm. */
export const saasFullstackPreset: ProductPreset = {
  id: 'saas-fullstack',
  label: 'SaaS Full-Stack',
  description: 'Landing + API pricing/invoices, disiapkan untuk npm deps (multi-stage).',
  tier1: 'TypeScript/Node — multi-stage npm install (dependencies menyusul per produk).',
  port: PORT,
  healthPath: HEALTH_PATH,
  keywords: ['saas', 'dashboard', 'subscription', 'checkout', 'billing', 'full-stack'],
  render(input: PresetRenderInput): RenderedPresetStack {
    return renderStack(
      {
        preset: 'saas-fullstack',
        port: PORT,
        healthPath: HEALTH_PATH,
        gate: GATE,
        dockerfile: dockerfileFor({
          preset: 'saas-fullstack',
          port: PORT,
          gate: GATE,
          multiStage: true,
        }),
        page,
        routes: (meta: DemoMeta) => ({
          '/api/pricing': {
            plan: 'starter',
            price: meta.pricing,
            currency: 'USD',
            seats: 3,
            generatedBy: meta.generatedBy,
          },
          '/api/invoices': {
            invoices: [
              { id: `${meta.slug}-0001`, amountCents: 2900, status: 'paid' },
              { id: `${meta.slug}-0002`, amountCents: 2900, status: 'paid' },
              { id: `${meta.slug}-0003`, amountCents: 29000, status: 'open' },
            ],
            totalCents: 34800,
          },
        }),
        extraFiles: (meta: DemoMeta) => ({
          'package.json': `${JSON.stringify(
            {
              name: `${meta.slug}-demo`,
              private: true,
              type: 'module',
              scripts: { start: 'node server.mjs', test: 'node selftest.mjs' },
            },
            null,
            2,
          )}\n`,
        }),
      },
      input,
    );
  },
};
