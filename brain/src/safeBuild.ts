/**
 * Safe-build bundle — fallback ketika circuit breaker trip (PRD §3.2).
 * Berkas ini selalu lolos guard, `tsc --noEmit`, dan `vitest run`,
 * sehingga run tetap menghasilkan artefak yang bisa dideploy meski loop QA gagal.
 */

export const TYPES_TS = `export interface LineItem {
  description: string;
  amountCents: number;
  qty: number;
}

export interface Invoice {
  id: string;
  customerRef: string;
  totalCents: number;
  currency: 'USD';
  paid: boolean;
}
`;

export const ENGINE_TS = `import type { LineItem } from '../types';

export function subtotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.amountCents * item.qty, 0);
}

export function applyDiscount(totalCents: number, percent: number): number {
  if (percent < 0 || percent > 100) {
    throw new RangeError(\`discount must be between 0 and 100, received \${percent}\`);
  }
  return Math.round(totalCents * (1 - percent / 100));
}

export function invoiceTotal(items: LineItem[], discountPercent = 0): number {
  return applyDiscount(subtotal(items), discountPercent);
}
`;

export function billingTs(slug: string): string {
  return `import { invoiceTotal } from './engine';
import type { Invoice, LineItem } from '../types';

let sequence = 0;

export function createInvoice(customerRef: string, items: LineItem[], discountPercent = 0): Invoice {
  sequence += 1;
  return {
    id: \`${slug}-\${String(sequence).padStart(4, '0')}\`,
    customerRef,
    totalCents: invoiceTotal(items, discountPercent),
    currency: 'USD',
    paid: false,
  };
}

export function markPaid(invoice: Invoice): Invoice {
  return { ...invoice, paid: true };
}
`;
}

export const ENGINE_SPEC_TS = `import { describe, expect, it } from 'vitest';
import { applyDiscount, invoiceTotal, subtotal } from '../src/lib/engine';
import type { LineItem } from '../src/types';

const items: LineItem[] = [
  { description: 'Pro plan', amountCents: 2900, qty: 2 },
  { description: 'Add-on', amountCents: 500, qty: 1 },
];

describe('invoice engine', () => {
  it('sums every line item', () => {
    expect(subtotal(items)).toBe(6300);
  });

  it('applies percentage discount with cent rounding', () => {
    expect(applyDiscount(999, 10)).toBe(899);
  });

  it('rejects out-of-range discounts', () => {
    expect(() => applyDiscount(100, 101)).toThrow(RangeError);
    expect(() => applyDiscount(100, -1)).toThrow(RangeError);
  });

  it('computes invoice totals idempotently', () => {
    const a = invoiceTotal(items, 10);
    const b = invoiceTotal(items, 10);
    expect(a).toBe(b);
    expect(a).toBe(5670);
  });

  it('returns 0 for an empty cart', () => {
    expect(invoiceTotal([])).toBe(0);
  });
});
`;

export const BILLING_SPEC_TS = `import { describe, expect, it } from 'vitest';
import { createInvoice, markPaid } from '../src/lib/billing';

describe('billing', () => {
  it('creates an invoice with a sequential id', () => {
    const first = createInvoice('cus_alpha', [{ description: 'Pro', amountCents: 2900, qty: 1 }]);
    const second = createInvoice('cus_alpha', [{ description: 'Pro', amountCents: 2900, qty: 1 }]);
    expect(first.id).not.toBe(second.id);
    expect(first.totalCents).toBe(2900);
    expect(first.currency).toBe('USD');
    expect(first.paid).toBe(false);
  });

  it('marks an invoice paid immutably', () => {
    const invoice = createInvoice('cus_beta', []);
    const paid = markPaid(invoice);
    expect(paid.paid).toBe(true);
    expect(invoice.paid).toBe(false);
  });
});
`;

/* ───────────── Struktur Dev Agent (AC: src/routes, src/components,
     src/lib/stripe.ts) — deterministik, lolos tsc + vitest ────────────── */

export const STRIPE_TS = `import { createHmac, timingSafeEqual } from 'node:crypto';

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: { amount: number; currency: string; customer?: string } };
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Verifikasi header Stripe-Signature (t=...,v1=...) dengan HMAC-SHA256. */
export function constructEvent(payload: string, signatureHeader: string, secret: string): StripeEvent {
  const fields: Record<string, string> = {};
  for (const pair of signatureHeader.split(',')) {
    const idx = pair.indexOf('=');
    if (idx > 0) fields[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  const timestamp = fields.t ?? '';
  const provided = fields.v1 ?? '';
  const expected = createHmac('sha256', secret).update(\`\${timestamp}.\${payload}\`).digest('hex');
  if (!safeEqual(expected, provided)) {
    throw new Error('Invalid stripe signature');
  }
  return JSON.parse(payload) as StripeEvent;
}

/** Idempotency check — webhook Stripe bisa dikirim ulang (PRD US-802). */
export function acceptOnce(seen: Set<string>, eventId: string): boolean {
  if (seen.has(eventId)) return false;
  seen.add(eventId);
  return true;
}
`;

export const STRIPE_SPEC_TS = `import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { acceptOnce, constructEvent, type StripeEvent } from '../src/lib/stripe';

const secret = 'whsec_test_secret';
const payload = JSON.stringify({
  id: 'evt_1',
  type: 'invoice.paid',
  data: { object: { amount: 2900, currency: 'usd' } },
} satisfies StripeEvent);
const ts = '1700000000';
const valid = createHmac('sha256', secret).update(\`\${ts}.\${payload}\`).digest('hex');

describe('stripe helper', () => {
  it('verifies a valid signature header', () => {
    const event = constructEvent(payload, \`t=\${ts},v1=\${valid}\`, secret);
    expect(event.id).toBe('evt_1');
    expect(event.type).toBe('invoice.paid');
  });

  it('rejects a tampered payload', () => {
    expect(() => constructEvent(payload + ' ', \`t=\${ts},v1=\${valid}\`, secret)).toThrow(
      'Invalid stripe signature',
    );
  });

  it('rejects a missing or malformed signature', () => {
    expect(() => constructEvent(payload, 'nope', secret)).toThrow('Invalid stripe signature');
  });

  it('accepts an event id only once (idempotency)', () => {
    const seen = new Set<string>();
    expect(acceptOnce(seen, 'evt_1')).toBe(true);
    expect(acceptOnce(seen, 'evt_1')).toBe(false);
    expect(acceptOnce(seen, 'evt_2')).toBe(true);
  });
});
`;

export const ROUTES_TS = `import { createInvoice } from '../lib/billing';
import { constructEvent, acceptOnce } from '../lib/stripe';
import type { LineItem } from '../types';

export interface RouteResponse {
  status: number;
  body: unknown;
}

export function handleCreateInvoice(
  customerRef: string,
  items: LineItem[],
  discountPercent = 0,
): RouteResponse {
  if (!customerRef) return { status: 400, body: { error: 'customerRef required' } };
  const invoice = createInvoice(customerRef, items, discountPercent);
  return { status: 201, body: invoice };
}

export function handleStripeWebhook(
  seen: Set<string>,
  payload: string,
  signatureHeader: string,
  secret: string,
): RouteResponse {
  try {
    const event = constructEvent(payload, signatureHeader, secret);
    const fresh = acceptOnce(seen, event.id);
    return { status: 200, body: { received: true, event: event.id, duplicate: !fresh } };
  } catch {
    return { status: 400, body: { error: 'invalid webhook' } };
  }
}
`;

export const ROUTES_SPEC_TS = `import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { handleCreateInvoice, handleStripeWebhook } from '../src/routes/invoices';

const secret = 'whsec_routes';
const payload = JSON.stringify({ id: 'evt_r1', type: 'charge.succeeded', data: { object: { amount: 2900, currency: 'usd' } } });
const ts = '1700000001';
const sig = \`t=\${ts},v1=\${createHmac('sha256', secret).update(\`\${ts}.\${payload}\`).digest('hex')}\`;

describe('invoice routes', () => {
  it('creates an invoice with 201', () => {
    const res = handleCreateInvoice('cus_1', [{ description: 'Pro', amountCents: 2900, qty: 2 }]);
    expect(res.status).toBe(201);
    expect((res.body as { totalCents: number }).totalCents).toBe(5800);
  });

  it('validates customerRef', () => {
    expect(handleCreateInvoice('', []).status).toBe(400);
  });

  it('handles a signed webhook idempotently', () => {
    const seen = new Set<string>();
    const first = handleStripeWebhook(seen, payload, sig, secret);
    const second = handleStripeWebhook(seen, payload, sig, secret);
    expect(first.status).toBe(200);
    expect((first.body as { duplicate: boolean }).duplicate).toBe(false);
    expect((second.body as { duplicate: boolean }).duplicate).toBe(true);
  });

  it('rejects an unsigned webhook', () => {
    expect(handleStripeWebhook(new Set(), payload, 't=1,v1=bad', secret).status).toBe(400);
  });
});
`;

export const COMPONENT_TS = `import type { Invoice } from '../types';

export function formatMoney(cents: number): string {
  return \`$\${(cents / 100).toFixed(2)}\`;
}

export function invoiceSummaryText(invoice: Invoice): string {
  const state = invoice.paid ? 'paid' : 'open';
  return \`\${invoice.id} · \${formatMoney(invoice.totalCents)} · \${state}\`;
}

export function invoiceSummaryHtml(invoice: Invoice): string {
  const state = invoice.paid ? 'paid' : 'open';
  return (
    '<div class="invoice" data-id="' +
    invoice.id +
    '"><span class="total">' +
    formatMoney(invoice.totalCents) +
    '</span><span class="state">' +
    state +
    '</span></div>'
  );
}
`;

export const COMPONENT_SPEC_TS = `import { describe, expect, it } from 'vitest';
import { formatMoney, invoiceSummaryHtml, invoiceSummaryText } from '../src/components/invoice-summary';
import type { Invoice } from '../src/types';

const invoice: Invoice = {
  id: 'auto-0001',
  customerRef: 'cus_9',
  totalCents: 2900,
  currency: 'USD',
  paid: false,
};

describe('invoice summary component', () => {
  it('formats money in dollars', () => {
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(12345)).toBe('$123.45');
  });

  it('renders a one-line text summary', () => {
    expect(invoiceSummaryText(invoice)).toBe('auto-0001 · $29.00 · open');
    expect(invoiceSummaryText({ ...invoice, paid: true })).toContain('paid');
  });

  it('renders escaped html with state class', () => {
    const html = invoiceSummaryHtml(invoice);
    expect(html).toContain('data-id="auto-0001"');
    expect(html).toContain('$29.00');
    expect(html).toContain('class="state">open<');
  });
});
`;

export function safeBuildBundle(): Record<string, string> {
  return {
    'src/types.ts': TYPES_TS,
    'src/lib/engine.ts': ENGINE_TS,
    'src/lib/billing.ts': billingTs('safebuild'),
    'tests/engine.spec.ts': ENGINE_SPEC_TS,
    'tests/billing.spec.ts': BILLING_SPEC_TS,
  };
}

/** Bundle lengkap (AC Dev Agent): routes + components + lib/stripe.ts. */
export function codeBundleFiles(slug: string): Record<string, string> {
  return {
    'src/types.ts': TYPES_TS,
    'src/lib/engine.ts': ENGINE_TS,
    'src/lib/billing.ts': billingTs(slug),
    'src/lib/stripe.ts': STRIPE_TS,
    'src/routes/invoices.ts': ROUTES_TS,
    'src/components/invoice-summary.ts': COMPONENT_TS,
    'tests/engine.spec.ts': ENGINE_SPEC_TS,
    'tests/billing.spec.ts': BILLING_SPEC_TS,
    'tests/stripe.spec.ts': STRIPE_SPEC_TS,
    'tests/routes.spec.ts': ROUTES_SPEC_TS,
    'tests/components.spec.ts': COMPONENT_SPEC_TS,
  };
}
