import { nowIso } from '../types';
import type { FirstSalePayload, PaymentProviderId, RevenueUpdatePayload } from '../types';
import type {
  CreatePaymentLinkInput,
  PaymentCurrency,
  PaymentLinkPayload,
  PaymentProvider,
  PaymentStatus,
  WebhookOutcome,
  WebhookRejectReason,
  WebhookRequest,
} from './provider';

/** Hasil normalisasi driver: field lintas-gateway + status internal. */
export interface NormalizedWebhook {
  eventId: string;
  status: PaymentStatus;
  /** true bila signature/verifikasi provider valid untuk request ini. */
  verified: boolean;
  amount: number;
  currency: PaymentCurrency;
  customer: { city: string; country: string; maskedEmail: string };
  /** ISO time dari gateway (dipakai bila ada, mis. transaction_time Midtrans). */
  timestamp?: string;
  /** Label ringkas untuk panel "Last Event" Theater. */
  label: string;
}

/** `null` = payload tak dikenali; `{ rejected }` = ditolak dengan alasan spesifik. */
export type NormalizeOutcome = NormalizedWebhook | { rejected: WebhookRejectReason } | null;

/**
 * Logika bersama semua driver PaymentProvider:
 * - idempotensi per event id (replay webhook tidak memicu celebration ganda);
 * - metrik revenue (salesCount/gross/lastEvent/signatureVerified);
 * - kebijakan offline: secret kosong → event demo tetap diproses, tetapi
 *   `signatureVerified=false` disiarkan jujur ke UI (perilaku Stripe lama).
 */
export abstract class BasePaymentSentinel implements PaymentProvider {
  abstract readonly id: PaymentProviderId;

  protected readonly seen = new Set<string>();
  private salesCount = 0;
  private gross = 0;
  private currency: PaymentCurrency = 'USD';
  activeVisitors = 0;
  checkoutSessions = 0;
  lastEvent = '';
  lastSignatureVerified = false;

  constructor(protected readonly secret?: string) {}

  /** Secret terpasang → wajib signature valid. */
  get requiresSignature(): boolean {
    return Boolean(this.secret);
  }

  /** Hosted payment page — format per gateway (Snap / Payment Link / demo stub). */
  abstract createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLinkPayload>;

  protected abstract normalize(req: WebhookRequest): NormalizeOutcome;

  receiveWebhook(req: WebhookRequest, runId: string): WebhookOutcome {
    const normalized = this.normalize(req);
    if (!normalized || 'rejected' in normalized) {
      this.lastSignatureVerified = false;
      const reason: WebhookRejectReason =
        normalized && 'rejected' in normalized ? normalized.rejected : 'invalid-payload';
      this.lastEvent = `rejected · ${reason}`;
      return {
        provider: this.id,
        accepted: false,
        signatureVerified: false,
        status: 'unknown',
        eventId: '',
        sale: null,
        reason,
      };
    }

    const n = normalized;
    this.lastSignatureVerified = n.verified;
    if (this.requiresSignature && !n.verified) {
      this.lastEvent = `rejected · invalid signature · ${n.label}`;
      return {
        provider: this.id,
        accepted: false,
        signatureVerified: false,
        status: n.status,
        eventId: n.eventId,
        sale: null,
        reason: 'invalid-signature',
      };
    }

    this.lastEvent = n.label;
    if (n.status !== 'settlement') {
      return {
        provider: this.id,
        accepted: true,
        signatureVerified: n.verified,
        status: n.status,
        eventId: n.eventId,
        sale: null,
      };
    }
    if (this.seen.has(n.eventId)) {
      return {
        provider: this.id,
        accepted: true,
        signatureVerified: n.verified,
        status: n.status,
        eventId: n.eventId,
        sale: null,
        duplicate: true,
      };
    }
    this.seen.add(n.eventId);
    this.salesCount += 1;
    this.gross += n.amount;
    this.currency = n.currency;
    const sale: FirstSalePayload = {
      runId,
      customer: n.customer,
      amount: n.amount,
      currency: n.currency,
      paymentProvider: this.id,
      paymentEventId: n.eventId,
      hasCustomers: true,
      timestamp: n.timestamp ?? nowIso(),
    };
    return {
      provider: this.id,
      accepted: true,
      signatureVerified: n.verified,
      status: n.status,
      eventId: n.eventId,
      sale,
    };
  }

  metrics(): RevenueUpdatePayload {
    return {
      runId: '',
      activeVisitors: this.activeVisitors,
      checkoutSessions: this.checkoutSessions,
      grossRevenueArr: this.gross,
      salesCount: this.salesCount,
      currency: this.currency,
      lastEvent: this.lastEvent,
      signatureVerified: this.lastSignatureVerified,
      timestamp: nowIso(),
    };
  }
}
