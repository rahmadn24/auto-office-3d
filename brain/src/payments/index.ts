import type { Config } from '../config';
import { MidtransSentinel } from './midtrans';
import type { PaymentProvider } from './provider';
import { StripeSentinel } from './stripe';
import { StubSentinel } from './stub';
import { XenditSentinel } from './xendit';

export * from './provider';
export { BasePaymentSentinel } from './base';
export {
  StripeSentinel,
  signStripePayload,
  verifyStripeSignature,
  type StripeEvent,
} from './stripe';
export {
  MIDTRANS_TOLERANCE_S,
  MidtransSentinel,
  mapMidtransStatus,
  parseMidtransTransactionTime,
  signMidtransNotification,
  verifyMidtransSignature,
  type MidtransNotification,
  type MidtransOptions,
} from './midtrans';
export { StubSentinel, type StubOptions } from './stub';
export { XenditSentinel } from './xendit';

/**
 * Pilih driver pembayaran dari config — pola sama dengan `createLLM`:
 * `auto` memakai gateway live hanya bila kredensialnya tersedia, selain itu
 * driver `stub` (demo lokal). Fail-fast config sudah menjamin driver yang
 * dipaksa eksplisit punya kredensialnya.
 */
export function createPayment(config: Config): PaymentProvider {
  switch (config.paymentDriver) {
    case 'stripe':
      if (!config.stripeWebhookSecret) {
        throw new Error('PAYMENT_DRIVER=stripe butuh STRIPE_WEBHOOK_SECRET');
      }
      return new StripeSentinel(config.stripeWebhookSecret, {
        apiKey: config.stripeSecretKey,
      });
    case 'midtrans':
      if (!config.midtransServerKey) {
        throw new Error('PAYMENT_DRIVER=midtrans butuh MIDTRANS_SERVER_KEY');
      }
      return new MidtransSentinel(config.midtransServerKey, { env: config.midtransEnv });
    case 'xendit':
      if (!config.xenditSecretKey) {
        throw new Error('PAYMENT_DRIVER=xendit butuh XENDIT_SECRET_KEY');
      }
      return new XenditSentinel(config.xenditSecretKey);
    default:
      return new StubSentinel({ demoBaseUrl: `http://localhost:${config.port}` });
  }
}
