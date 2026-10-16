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

export function safeBuildBundle(): Record<string, string> {
  return {
    'src/types.ts': TYPES_TS,
    'src/lib/engine.ts': ENGINE_TS,
    'src/lib/billing.ts': billingTs('safebuild'),
    'tests/engine.spec.ts': ENGINE_SPEC_TS,
    'tests/billing.spec.ts': BILLING_SPEC_TS,
  };
}
