import { nowIso } from '../types';
import { BasePaymentSentinel, type NormalizeOutcome } from './base';
import type {
  CreatePaymentLinkInput,
  DemoPaymentSurface,
  PaymentCurrency,
  PaymentLinkPayload,
  WebhookOutcome,
  WebhookRequest,
} from './provider';

interface StubLink {
  leadId: string;
  amount: number;
  currency: PaymentCurrency;
  expiresAt: string;
}

/** Body notification demo — bentuknya sengaja mirip gateway nyata. */
interface StubNotification {
  order_id?: string;
  transaction_status?: string;
  gross_amount?: number | string;
  currency?: string;
  payment_type?: string;
  order_time?: string;
}

export interface StubOptions {
  /** Basis URL halaman demo lokal (default http://localhost:4800). */
  demoBaseUrl?: string;
}

/**
 * Driver `stub` (PRD §7 Fase 9) — demo lokal tanpa akun gateway:
 * `createPaymentLink` menghasilkan URL checkout demo (`/demo/checkout`),
 * dan endpoint simulasi bayar (`/demo/pay`) memicu webhook internal yang
 * dinormalisasi seperti gateway nyata. Tanpa signature (offline demo).
 */
export class StubSentinel extends BasePaymentSentinel implements DemoPaymentSurface {
  readonly id = 'stub' as const;
  readonly demoBaseUrl: string;
  private readonly links = new Map<string, StubLink>();

  constructor(opts: StubOptions = {}) {
    super(undefined);
    this.demoBaseUrl = opts.demoBaseUrl ?? 'http://localhost:4800';
  }

  async createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLinkPayload> {
    const orderId = `stub_${input.leadId.replace(/[^a-zA-Z0-9_-]/g, '-')}_${Date.now().toString(36)}`;
    const expiresAt = new Date(Date.now() + (input.expiresInS ?? 3600) * 1000).toISOString();
    this.links.set(orderId, {
      leadId: input.leadId,
      amount: input.amount,
      currency: input.currency,
      expiresAt,
    });
    return {
      leadId: input.leadId,
      provider: this.id,
      checkoutUrl: `${this.demoBaseUrl}/demo/checkout?order_id=${encodeURIComponent(orderId)}`,
      amount: input.amount,
      currency: input.currency,
      expiresAt,
      timestamp: nowIso(),
    };
  }

  peekLink(orderId: string): { leadId: string; amount: number; currency: PaymentCurrency } | null {
    const link = this.links.get(orderId);
    return link ? { leadId: link.leadId, amount: link.amount, currency: link.currency } : null;
  }

  /** Notification settlement untuk order demo — dipakai server `POST /demo/pay`. */
  demoNotification(orderId: string): WebhookRequest | null {
    const link = this.links.get(orderId);
    if (!link) return null;
    const notif: StubNotification = {
      order_id: orderId,
      transaction_status: 'settlement',
      gross_amount: link.amount,
      currency: link.currency,
      payment_type: 'qris_demo',
      order_time: nowIso(),
    };
    return { rawBody: JSON.stringify(notif) };
  }

  protected normalize(req: WebhookRequest): NormalizeOutcome {
    let notif: StubNotification;
    try {
      notif = JSON.parse(req.rawBody) as StubNotification;
    } catch {
      return null;
    }
    if (!notif || typeof notif !== 'object' || !notif.order_id) return null;

    const link = this.links.get(notif.order_id);
    if (!link) return { rejected: 'unknown-order' };

    const amount = Number(notif.gross_amount ?? link.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const currency: PaymentCurrency =
      (notif.currency ?? link.currency).toUpperCase() === 'USD' ? 'USD' : 'IDR';
    const status = notif.transaction_status === 'pending' ? 'pending' : 'settlement';

    return {
      eventId: notif.order_id,
      status,
      verified: false,
      amount,
      currency,
      customer: { city: 'Jakarta', country: 'ID', maskedEmail: 'b***@demo.local' },
      timestamp: nowIso(),
      label: `${notif.transaction_status ?? 'settlement'} · ${notif.payment_type ?? 'demo'} · ${notif.order_id}`,
      leadId: link.leadId,
    };
  }

  /**
   * Simulasi demo: 1 transaksi USD 29 (narasi "first $29 ARR" run otonom).
   * `eventId` deterministik (mis. `evt_<runId>`) → idempoten saat resume run.
   */
  simulateSale(runId: string, eventId?: string): WebhookOutcome {
    const orderId = eventId ?? `stub_sim_${Date.now().toString(36)}`;
    this.links.set(orderId, {
      leadId: 'demo_lead',
      amount: 29,
      currency: 'USD',
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
    return this.receiveWebhook({ rawBody: JSON.stringify({ order_id: orderId }) }, runId);
  }
}
