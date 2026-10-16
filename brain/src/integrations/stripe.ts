import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FirstSalePayload, RevenueUpdatePayload } from '../types';

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: {
    object: {
      amount_total?: number;
      currency?: string;
      customer_details?: { email?: string; address?: { city?: string; country?: string } };
      customer?: string;
    };
  };
}

/**
 * Verifikasi signature webhook Stripe (HMAC SHA-256, PRD §3.4 & §5.2).
 * Header `Stripe-Signature`: `t=<unix>,v1=<hex>` — signed payload = `${t}.${rawBody}`.
 */
export function verifyStripeSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
  opts: { toleranceS?: number; now?: number } = {},
): boolean {
  const parts = Object.fromEntries(
    sigHeader
      .split(',')
      .map((kv) => kv.split('=') as [string, string])
      .filter((p): p is [string, string] => p.length === 2),
  );
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;

  const tolerance = opts.toleranceS ?? 300;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > tolerance) return false;

  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Bangun header signature — dipakai unit test & SIMULATE WEBHOOK demo. */
export function signStripePayload(
  rawBody: string,
  secret: string,
  ts = Math.floor(Date.now() / 1000),
): string {
  const v1 = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return `t=${ts},v1=${v1}`;
}

export function parseFirstSaleFromEvent(
  event: StripeEvent,
  runId: string,
): FirstSalePayload | null {
  if (event.type !== 'checkout.session.completed' && event.type !== 'payment_intent.succeeded') {
    return null;
  }
  const obj = event.data.object;
  const amount = (obj.amount_total ?? 2900) / 100;
  return {
    runId,
    customer: {
      city: obj.customer_details?.address?.city ?? 'San Francisco',
      country: obj.customer_details?.address?.country ?? 'US',
      maskedEmail: maskEmail(obj.customer_details?.email ?? 'buyer@example.com'),
    },
    amount,
    currency: 'USD',
    stripeEventId: event.id,
    hasCustomers: true,
    timestamp: new Date(event.created * 1000).toISOString(),
  };
}

function maskEmail(email: string): string {
  const [user = 'x', domain = 'example.com'] = email.split('@');
  const head = user.slice(0, 1);
  return `${head}***@${domain}`;
}

/**
 * Stripe Webhook Sentinel (PRD §3.4): memantau metrik & menerjemahkan event
 * pertama ($29.00 ARR) jadi FirstSalePayload. Idempoten per stripeEventId.
 */
export class StripeSentinel {
  private readonly seen = new Set<string>();
  private salesCount = 0;
  private gross = 0;
  activeVisitors = 0;
  checkoutSessions = 0;
  lastStripeEvent = '';
  lastSignatureVerified = false;

  constructor(readonly webhookSecret: string | undefined) {}

  /** Terima raw body + header; kembalikan FirstSalePayload bila transaksi pertama. */
  receive(rawBody: string, sigHeader: string, runId: string): FirstSalePayload | null {
    let event: StripeEvent;
    try {
      event = JSON.parse(rawBody) as StripeEvent;
    } catch {
      this.lastStripeEvent = 'invalid JSON';
      this.lastSignatureVerified = false;
      return null;
    }

    const verified = this.webhookSecret
      ? verifyStripeSignature(rawBody, sigHeader, this.webhookSecret)
      : false;
    this.lastSignatureVerified = verified;
    // Tanpa secret (mode offline) signature dianggap tidak diverifikasi —
    // event tetap diproses untuk demo, tetapi flag disiarkan jujur ke UI.
    this.lastStripeEvent = `${event.type} · ${event.data.object.customer ?? 'cus_unknown'}`;

    const sale = parseFirstSaleFromEvent(event, runId);
    if (!sale) return null;
    if (this.seen.has(sale.stripeEventId)) return null; // idempoten
    this.seen.add(sale.stripeEventId);
    this.salesCount += 1;
    this.gross += sale.amount;
    return sale;
  }

  metrics(): RevenueUpdatePayload {
    return {
      runId: '',
      activeVisitors: this.activeVisitors,
      checkoutSessions: this.checkoutSessions,
      grossRevenueArr: this.gross,
      salesCount: this.salesCount,
      lastStripeEvent: this.lastStripeEvent,
      signatureVerified: this.lastSignatureVerified,
      timestamp: new Date().toISOString(),
    };
  }
}
