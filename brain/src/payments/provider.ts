import type { FirstSalePayload, PaymentProviderId, RevenueUpdatePayload } from '../types';

/**
 * Abstraksi Payment Sentinel multi-provider (PRD §3.4 & §8).
 *
 * Tujuan: pergantian gateway (Stripe ↔ Midtrans ↔ Xendit ↔ stub demo)
 * **tidak menyentuh Theater & milestone** — semua webhook dinormalisasi ke
 * `FirstSalePayload` yang sama (PRD §5.2) dan disiarkan lewat `bus.milestone`.
 */

export const PAYMENT_STATUSES = ['settlement', 'pending', 'expiry', 'deny', 'unknown'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_CURRENCIES = ['USD', 'IDR'] as const;
export type PaymentCurrency = (typeof PAYMENT_CURRENCIES)[number];

/** Alasan webhook ditolak — dipetakan ke HTTP status oleh server. */
export type WebhookRejectReason = 'invalid-signature' | 'invalid-payload' | 'unknown-order';

/** Raw HTTP request webhook (body + header) yang diberikan server ke provider. */
export interface WebhookRequest {
  rawBody: string;
  headers?: Record<string, string | string[] | undefined>;
}

/** Hasil verifikasi + normalisasi webhook lintas gateway. */
export interface WebhookOutcome {
  provider: PaymentProviderId;
  /** false = ditolak (signature invalid / payload tak dikenali / order tak dikenal). */
  accepted: boolean;
  signatureVerified: boolean;
  /** Status internal ternormalisasi (settlement/pending/expiry/deny/unknown). */
  status: PaymentStatus;
  eventId: string;
  /** Terisi hanya saat settlement pertama — idempoten per event id. */
  sale: FirstSalePayload | null;
  /** true bila event valid tapi sudah pernah diproses. */
  duplicate?: boolean;
  reason?: WebhookRejectReason;
}

export interface CreatePaymentLinkInput {
  /** Deal/lead yang ditagih (Fase 11: berasal dari CS Inbox). */
  leadId: string;
  amount: number;
  currency: PaymentCurrency;
  productName?: string;
  customerEmail?: string;
  /** Masa berlaku link dalam detik — driver memakai default bila kosong. */
  expiresInS?: number;
}

/** Payload event `payment:link_created` (PRD §5.4) — konsumen pertama: CS Agent (Fase 11). */
export interface PaymentLinkPayload {
  leadId: string;
  provider: PaymentProviderId;
  checkoutUrl: string;
  amount: number;
  currency: PaymentCurrency;
  contractUrl?: string;
  expiresAt?: string;
  timestamp: string;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  /** true = secret terpasang → webhook tanpa signature valid DITOLAK (tanpa mengubah metrik). */
  readonly requiresSignature: boolean;
  readonly lastSignatureVerified: boolean;
  /** Hosted payment page (Snap / Payment Link / halaman demo stub). */
  createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLinkPayload>;
  /** Verifikasi + normalisasi webhook → outcome; idempoten per event id. */
  receiveWebhook(req: WebhookRequest, runId: string): WebhookOutcome;
  /** Simulasi transaksi demo (tombol Theater) — opsional per driver. */
  simulateSale?(runId: string, eventId?: string): WebhookOutcome;
  metrics(): RevenueUpdatePayload;
}

/** Permukaan demo stub (halaman checkout lokal /demo/*) — dipakai server/http. */
export interface DemoPaymentSurface {
  demoBaseUrl: string;
  peekLink(orderId: string): { leadId: string; amount: number; currency: PaymentCurrency } | null;
  /** Body notification settlement untuk sebuah order demo (null bila tak dikenal). */
  demoNotification(orderId: string): WebhookRequest | null;
}

export function isDemoPayment(
  provider: PaymentProvider,
): provider is PaymentProvider & DemoPaymentSurface {
  const p = provider as Partial<DemoPaymentSurface>;
  return typeof p.peekLink === 'function' && typeof p.demoNotification === 'function';
}
