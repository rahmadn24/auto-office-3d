import { createHash, timingSafeEqual } from 'node:crypto';

import { nowIso } from '../types';
import { BasePaymentSentinel, type NormalizeOutcome } from './base';
import type {
  CreatePaymentLinkInput,
  PaymentCurrency,
  PaymentLinkPayload,
  PaymentStatus,
  WebhookOutcome,
  WebhookRequest,
} from './provider';

/** Notifikasi HTTP Midtrans (subset field yang dibutuhkan, PRD §8). */
export interface MidtransNotification {
  order_id?: string;
  status_code?: string;
  gross_amount?: string | number;
  signature_key?: string;
  transaction_status?: string;
  fraud_status?: string;
  transaction_id?: string;
  /** WIB (GMT+7), format `YYYY-MM-DD HH:mm:ss`. */
  transaction_time?: string;
  payment_type?: string;
  currency?: string;
  customer_details?: {
    email?: string;
    first_name?: string;
    address?: { city?: string; country_code?: string };
  };
  /** Konvensi demo: leadId dari CS Agent (Fase 11). */
  custom_field1?: string;
}

/** Toleransi default notifikasi basi (replay): 7 hari — drift timezone aman. */
export const MIDTRANS_TOLERANCE_S = 7 * 24 * 3600;

/** gross_amount Midtrans datang sebagai string ("29000.00") — jaga apa adanya. */
function grossAmountString(value: string | number | undefined): string {
  if (typeof value === 'number') return value.toFixed(2);
  return value ?? '';
}

/**
 * Verifikasi signature notifikasi Midtrans (PRD §8):
 * `SHA-512(order_id + status_code + gross_amount + serverKey)` — dibandingkan
 * constant-time dengan `signature_key`.
 */
export function verifyMidtransSignature(
  notif: Pick<MidtransNotification, 'order_id' | 'status_code' | 'gross_amount' | 'signature_key'>,
  serverKey: string,
): boolean {
  const signature = notif.signature_key ?? '';
  if (!signature) return false;
  const source = `${notif.order_id ?? ''}${notif.status_code ?? ''}${grossAmountString(notif.gross_amount)}${serverKey}`;
  const expected = createHash('sha512').update(source).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature.toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Menghitung signature_key valid — dipakai unit test & simulasi demo. */
export function signMidtransNotification(
  notif: Pick<MidtransNotification, 'order_id' | 'status_code' | 'gross_amount'>,
  serverKey: string,
): string {
  const source = `${notif.order_id ?? ''}${notif.status_code ?? ''}${grossAmountString(notif.gross_amount)}${serverKey}`;
  return createHash('sha512').update(source).digest('hex');
}

/**
 * Mapping status Midtrans → status internal (PRD §7 Fase 9):
 * settlement/capture(+fraud accept) → `settlement`; pending/challenge → `pending`;
 * expire → `expiry`; deny/cancel/refund/chargeback → `deny`.
 */
export function mapMidtransStatus(
  transactionStatus: string | undefined,
  fraudStatus?: string | undefined,
): PaymentStatus {
  switch (transactionStatus) {
    case 'capture':
      return fraudStatus === 'challenge' ? 'pending' : 'settlement';
    case 'settlement':
      return 'settlement';
    case 'pending':
      return 'pending';
    case 'expire':
    case 'expired':
      return 'expiry';
    case 'deny':
    case 'cancel':
    case 'refund':
    case 'partial_refund':
    case 'chargeback':
    case 'partial_chargeback':
      return 'deny';
    default:
      return 'unknown';
  }
}

/** Parse `transaction_time` WIB (`YYYY-MM-DD HH:mm:ss`, GMT+7) atau ISO → epoch ms. */
export function parseMidtransTransactionTime(value: string | undefined): number | null {
  if (!value) return null;
  const wib = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (wib) {
    const [, y, mo, d, h, mi, s] = wib;
    return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}+07:00`);
  }
  const iso = Date.parse(value);
  return Number.isNaN(iso) ? null : iso;
}

/** Format waktu sebagai WIB `YYYY-MM-DD HH:mm:ss` (simulasi notifikasi). */
function formatWib(date: Date): string {
  const wibMs = date.getTime() + 7 * 3600 * 1000;
  const d = new Date(wibMs);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function maskEmail(email: string): string {
  const [user = 'x', domain = 'example.com'] = email.split('@');
  return `${user.slice(0, 1)}***@${domain}`;
}

const SNAP_BASE_URL = {
  sandbox: 'https://app.sandbox.midtrans.com',
  production: 'https://app.midtrans.com',
} as const;

export interface MidtransOptions {
  env?: keyof typeof SNAP_BASE_URL;
  /** Override endpoint (test / mocking tanpa jaringan). */
  baseUrl?: string;
  /** Toleransi notifikasi basi (detik); `0` = nonaktif. */
  toleranceS?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Midtrans Snap Sentinel — driver PaymentProvider market Indonesia (PRD §8):
 * QRIS/VA/e-wallet via hosted Snap page + verifikasi notifikasi SHA-512.
 * Tanpa serverKey (mode offline) notifikasi tetap diproses untuk demo dengan
 * `signatureVerified=false`; secret terpasang → hanya signature valid diproses.
 */
export class MidtransSentinel extends BasePaymentSentinel {
  readonly id = 'midtrans' as const;
  private readonly baseUrl: string;
  private readonly toleranceS: number;
  private readonly fetchImpl: typeof fetch;

  constructor(serverKey?: string, opts: MidtransOptions = {}) {
    super(serverKey);
    this.baseUrl = opts.baseUrl ?? SNAP_BASE_URL[opts.env ?? 'sandbox'];
    this.toleranceS = opts.toleranceS ?? MIDTRANS_TOLERANCE_S;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Boot Snap transaction → hosted checkout URL (redirect_url). */
  async createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLinkPayload> {
    if (!this.secret) {
      throw new Error('createPaymentLink butuh MIDTRANS_SERVER_KEY (PAYMENT_DRIVER=midtrans)');
    }
    const orderId = `${input.leadId.replace(/[^a-zA-Z0-9_-]/g, '-')}-${Date.now().toString(36)}`;
    const body = {
      transaction_details: { order_id: orderId, gross_amount: input.amount },
      ...(input.customerEmail ? { customer_details: { email: input.customerEmail } } : {}),
      ...(input.expiresInS ? { expiry: { unit: 'seconds', duration: input.expiresInS } } : {}),
      custom_field1: input.leadId,
    };
    const res = await this.fetchImpl(`${this.baseUrl}/snap/v1/transactions`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.secret}:`).toString('base64')}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as {
      redirect_url?: string;
      error_messages?: string[];
    } | null;
    if (!res.ok || !json?.redirect_url) {
      throw new Error(
        `Midtrans Snap error ${res.status}: ${json?.error_messages?.join(', ') ?? 'no redirect_url'}`,
      );
    }
    return {
      leadId: input.leadId,
      provider: this.id,
      checkoutUrl: json.redirect_url,
      amount: input.amount,
      currency: input.currency,
      expiresAt: input.expiresInS
        ? new Date(Date.now() + input.expiresInS * 1000).toISOString()
        : undefined,
      timestamp: nowIso(),
    };
  }

  protected normalize(req: WebhookRequest): NormalizeOutcome {
    let notif: MidtransNotification;
    try {
      notif = JSON.parse(req.rawBody) as MidtransNotification;
    } catch {
      return null;
    }
    if (!notif || typeof notif !== 'object' || !notif.order_id || !notif.transaction_status) {
      return null;
    }
    const amount = Number.parseFloat(grossAmountString(notif.gross_amount));
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const status = mapMidtransStatus(notif.transaction_status, notif.fraud_status);
    let verified = this.secret ? verifyMidtransSignature(notif, this.secret) : false;
    // Toleransi waktu: signature valid tapi notifikasi basi (replay) ditolak.
    if (verified && this.toleranceS > 0) {
      const ts = parseMidtransTransactionTime(notif.transaction_time);
      if (ts !== null && Math.abs(Date.now() - ts) > this.toleranceS * 1000) verified = false;
    }
    const currency: PaymentCurrency =
      (notif.currency ?? 'IDR').toUpperCase() === 'USD' ? 'USD' : 'IDR';
    const eventId = notif.transaction_id ?? notif.order_id;
    const ts = parseMidtransTransactionTime(notif.transaction_time);

    return {
      eventId,
      status,
      verified,
      amount,
      currency,
      customer: {
        city: notif.customer_details?.address?.city ?? 'Jakarta',
        country: notif.customer_details?.address?.country_code ?? 'ID',
        maskedEmail: maskEmail(notif.customer_details?.email ?? 'buyer@example.com'),
      },
      timestamp: ts !== null ? new Date(ts).toISOString() : nowIso(),
      label: `${notif.transaction_status}${notif.fraud_status ? `/${notif.fraud_status}` : ''} · ${notif.payment_type ?? 'snap'} · ${eventId}`,
      ...(notif.custom_field1 ? { leadId: notif.custom_field1 } : {}),
    };
  }

  /** Simulasi transaksi demo (tombol Theater / run otonom offline). */
  simulateSale(runId: string, eventId?: string): WebhookOutcome {
    const orderId = eventId ?? `sim_${Date.now().toString(36)}`;
    const notif: MidtransNotification = {
      order_id: orderId,
      status_code: '200',
      gross_amount: '29000.00',
      transaction_status: 'settlement',
      fraud_status: 'accept',
      transaction_id: `trx_${orderId}`,
      transaction_time: formatWib(new Date()),
      payment_type: 'qris',
      currency: 'IDR',
      customer_details: {
        email: 'demo.buyer@founderscaled.io',
        address: { city: 'Jakarta', country_code: 'ID' },
      },
    };
    if (this.secret) {
      notif.signature_key = signMidtransNotification(
        {
          order_id: notif.order_id,
          status_code: notif.status_code,
          gross_amount: notif.gross_amount,
        },
        this.secret,
      );
    }
    return this.receiveWebhook({ rawBody: JSON.stringify(notif) }, runId);
  }
}
