import { createHmac, timingSafeEqual } from 'node:crypto';

import { nowIso } from '../types';
import type {
  CreatePaymentLinkInput,
  PaymentCurrency,
  PaymentLinkPayload,
  WebhookOutcome,
  WebhookRequest,
} from './provider';
import { BasePaymentSentinel, type NormalizeOutcome } from './base';

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
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return false;

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

/** Amount Stripe (minor unit) → nominal; IDR zero-decimal (tanpa /100). */
function stripeMoney(
  amountTotal: number,
  currency: string,
): { amount: number; currency: PaymentCurrency } {
  const cur: PaymentCurrency = currency.toUpperCase() === 'IDR' ? 'IDR' : 'USD';
  return { amount: cur === 'IDR' ? amountTotal : amountTotal / 100, currency: cur };
}

function maskEmail(email: string): string {
  const [user = 'x', domain = 'example.com'] = email.split('@');
  const head = user.slice(0, 1);
  return `${head}***@${domain}`;
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string {
  const raw = headers?.[name];
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
}

/**
 * Stripe Webhook Sentinel (PRD §3.4) — driver PaymentProvider:
 * verifikasi HMAC SHA-256 lalu normalisasi `checkout.session.completed` /
 * `payment_intent.succeeded` menjadi FirstSalePayload yang sama lintas gateway.
 * Idempoten per `stripeEventId` (kini `paymentEventId` di payload §5.2).
 */
export class StripeSentinel extends BasePaymentSentinel {
  readonly id = 'stripe' as const;
  private readonly fetchImpl: typeof fetch;
  /** Secret API (`sk_...`) — hanya dibutuhkan untuk membuat Payment Link. */
  private readonly apiKey?: string;

  constructor(webhookSecret?: string, opts: { apiKey?: string; fetchImpl?: typeof fetch } = {}) {
    super(webhookSecret);
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Stripe Payment Link (PRD §8, market internasional) — hosted page via
   * `POST /v1/payment_links` dengan harga inline (tanpa dashboard Price ID).
   */
  async createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLinkPayload> {
    if (!this.apiKey) {
      throw new Error('createPaymentLink butuh STRIPE_SECRET_KEY (PAYMENT_DRIVER=stripe)');
    }
    const unitAmount =
      input.currency === 'IDR' ? Math.round(input.amount) : Math.round(input.amount * 100);
    const params = new URLSearchParams({
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': input.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(unitAmount),
      'line_items[0][price_data][product_data][name]': input.productName ?? `Deal ${input.leadId}`,
    });
    const res = await this.fetchImpl('https://api.stripe.com/v1/payment_links', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const json = (await res.json().catch(() => null)) as {
      url?: string;
      error?: { message?: string };
    } | null;
    if (!res.ok || !json?.url) {
      throw new Error(
        `Stripe Payment Link error ${res.status}: ${json?.error?.message ?? 'no url'}`,
      );
    }
    return {
      leadId: input.leadId,
      provider: this.id,
      checkoutUrl: json.url,
      amount: input.amount,
      currency: input.currency,
      expiresAt: input.expiresInS
        ? new Date(Date.now() + input.expiresInS * 1000).toISOString()
        : undefined,
      timestamp: nowIso(),
    };
  }

  protected normalize(req: WebhookRequest): NormalizeOutcome {
    let event: StripeEvent;
    try {
      event = JSON.parse(req.rawBody) as StripeEvent;
    } catch {
      return null;
    }
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return null;

    const obj = event.data?.object ?? {};
    const verified = this.secret
      ? verifyStripeSignature(
          req.rawBody,
          headerValue(req.headers, 'stripe-signature'),
          this.secret,
        )
      : false;
    const { amount, currency } = stripeMoney(obj.amount_total ?? 2900, obj.currency ?? 'usd');
    const eventId = event.id || `evt_stripe_${event.created ?? Date.now()}`;
    const isSale =
      event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded';

    return {
      eventId,
      status: isSale ? 'settlement' : 'unknown',
      verified,
      amount,
      currency,
      customer: {
        city: obj.customer_details?.address?.city ?? 'San Francisco',
        country: obj.customer_details?.address?.country ?? 'US',
        maskedEmail: maskEmail(obj.customer_details?.email ?? 'buyer@example.com'),
      },
      timestamp: event.created ? new Date(event.created * 1000).toISOString() : nowIso(),
      label: `${event.type} · ${obj.customer ?? 'cus_unknown'}`,
    };
  }

  /** Simulasi transaksi demo (tombol Theater / node marketing run otonom). */
  simulateSale(runId: string, eventId?: string): WebhookOutcome {
    const event: StripeEvent = {
      id: eventId ?? `evt_sim_${Date.now().toString(36)}`,
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          amount_total: 2900,
          currency: 'usd',
          customer: `cus_sim_${Math.floor(Math.random() * 1e6)}`,
          customer_details: {
            email: 'demo.buyer@founderscaled.io',
            address: { city: 'San Francisco', country: 'US' },
          },
        },
      },
    };
    const rawBody = JSON.stringify(event);
    return this.receiveWebhook(
      {
        rawBody,
        headers: { 'stripe-signature': signStripePayload(rawBody, this.secret ?? 'whsec_offline') },
      },
      runId,
    );
  }
}
