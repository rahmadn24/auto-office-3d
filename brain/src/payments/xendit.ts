import { nowIso } from '../types';
import type { RevenueUpdatePayload } from '../types';
import type {
  CreatePaymentLinkInput,
  PaymentLinkPayload,
  PaymentProvider,
  WebhookOutcome,
  WebhookRequest,
} from './provider';

const NOT_IMPLEMENTED =
  'xendit driver belum diimplementasikan — dijadwalkan Fase 11 (PRD §8: quote → payment link)';

/**
 * Kerangka driver Xendit (PRD §7 Fase 9, opsional): kontrak PaymentProvider
 * sudah final sehingga implementasi tinggal diisi (invoice + webhook
 * callback token) tanpa menyentuh Theater & milestone.
 */
export class XenditSentinel implements PaymentProvider {
  readonly id = 'xendit' as const;
  readonly requiresSignature = true;
  readonly lastSignatureVerified = false;

  constructor(private readonly secretKey: string) {}

  async createPaymentLink(_input: CreatePaymentLinkInput): Promise<PaymentLinkPayload> {
    void _input;
    throw new Error(NOT_IMPLEMENTED);
  }

  receiveWebhook(_req: WebhookRequest, _runId: string): WebhookOutcome {
    void _req;
    void _runId;
    throw new Error(NOT_IMPLEMENTED);
  }

  metrics(): RevenueUpdatePayload {
    return {
      runId: '',
      activeVisitors: 0,
      checkoutSessions: 0,
      grossRevenueArr: 0,
      salesCount: 0,
      currency: 'USD',
      lastEvent: 'xendit driver stub — not implemented',
      signatureVerified: false,
      timestamp: nowIso(),
    };
  }
}
