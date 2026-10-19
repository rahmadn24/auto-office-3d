import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';
import {
  MIDTRANS_TOLERANCE_S,
  MidtransSentinel,
  StripeSentinel,
  StubSentinel,
  XenditSentinel,
  createPayment,
  mapMidtransStatus,
  parseMidtransTransactionTime,
  signMidtransNotification,
  signStripePayload,
  verifyMidtransSignature,
  verifyStripeSignature,
  type MidtransNotification,
} from '../src/payments';
import { formatMoney } from '../src/types';

/* ───────────── Stripe (migrasi Fase 4 → payments/stripe) ───────────── */

describe('Stripe signature verification (PRD §3.4)', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const secret = 'whsec_test';

  it('signature valid diterima, body dimanipulasi ditolak', () => {
    const sig = signStripePayload(body, secret, 1_700_000_000);
    expect(verifyStripeSignature(body, sig, secret, { now: 1_700_000_000 })).toBe(true);
    expect(verifyStripeSignature(`${body} `, sig, secret, { now: 1_700_000_000 })).toBe(false);
  });

  it('tolak signature kedaluwarsa (lewat tolerance)', () => {
    const sig = signStripePayload(body, secret, 1_700_000_000);
    expect(
      verifyStripeSignature(body, sig, secret, { now: 1_700_000_000 + 400, toleranceS: 300 }),
    ).toBe(false);
  });

  it('tolak secret berbeda', () => {
    const sig = signStripePayload(body, secret, 1_700_000_000);
    expect(verifyStripeSignature(body, sig, 'whsec_other', { now: 1_700_000_000 })).toBe(false);
  });
});

describe('StripeSentinel → PaymentProvider (Fase 9)', () => {
  const secret = 'whsec_idem';
  function headers(raw: string, sig: string): { headers: Record<string, string> } {
    return { headers: { 'stripe-signature': sig } };
  }
  function makeEvent(id: string, type = 'checkout.session.completed'): string {
    return JSON.stringify({
      id,
      type,
      created: Math.floor(Date.now() / 1000),
      data: { object: { amount_total: 2900, currency: 'usd', customer: 'cus_1' } },
    });
  }

  it('event ganda tidak memicu dua celebration (idempoten per paymentEventId)', () => {
    const sentinel = new StripeSentinel(secret);
    const raw = makeEvent('evt_same');
    const sig = signStripePayload(raw, secret);
    const first = sentinel.receiveWebhook({ rawBody: raw, ...headers(raw, sig) }, 'run_a');
    const second = sentinel.receiveWebhook({ rawBody: raw, ...headers(raw, sig) }, 'run_a');
    expect(first.sale?.paymentEventId).toBe('evt_same');
    expect(first.sale?.paymentProvider).toBe('stripe');
    expect(second.sale).toBeNull();
    expect(second.duplicate).toBe(true);
    expect(sentinel.metrics().salesCount).toBe(1);
    expect(sentinel.metrics().grossRevenueArr).toBe(29);
  });

  it('signature diverifikasi & flag disiarkan', () => {
    const sentinel = new StripeSentinel(secret);
    const raw = makeEvent('evt_ok');
    sentinel.receiveWebhook(
      { rawBody: raw, ...headers(raw, signStripePayload(raw, secret)) },
      'run_b',
    );
    expect(sentinel.lastSignatureVerified).toBe(true);
    expect(sentinel.metrics().lastEvent).toContain('checkout.session.completed');
  });

  it('secret terpasang + signature invalid → ditolak tanpa mengubah metrik', () => {
    const sentinel = new StripeSentinel(secret);
    const raw = makeEvent('evt_forged');
    const outcome = sentinel.receiveWebhook(
      { rawBody: raw, ...headers(raw, 't=1,v1=deadbeef') },
      'run_c',
    );
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toBe('invalid-signature');
    expect(outcome.sale).toBeNull();
    expect(sentinel.lastSignatureVerified).toBe(false);
    expect(sentinel.metrics().salesCount).toBe(0);
    expect(sentinel.metrics().grossRevenueArr).toBe(0);
  });

  it('tanpa secret (offline) event tetap diproses untuk demo', () => {
    const sentinel = new StripeSentinel(undefined);
    const raw = makeEvent('evt_offline');
    const outcome = sentinel.receiveWebhook({ rawBody: raw }, 'run_d');
    expect(outcome.sale).not.toBeNull();
    expect(outcome.signatureVerified).toBe(false);
    expect(sentinel.requiresSignature).toBe(false);
  });

  it('mata uang IDR diproses zero-decimal (tanpa /100)', () => {
    const sentinel = new StripeSentinel(undefined);
    const raw = JSON.stringify({
      id: 'evt_idr',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: { object: { amount_total: 290000, currency: 'idr', customer: 'cus_idr' } },
    });
    const outcome = sentinel.receiveWebhook({ rawBody: raw }, 'run_idr');
    expect(outcome.sale?.currency).toBe('IDR');
    expect(outcome.sale?.amount).toBe(290000);
  });

  it('event non-sale diterima tanpa milestone (ack 200 tanpa celebration)', () => {
    const sentinel = new StripeSentinel(undefined);
    const outcome = sentinel.receiveWebhook(
      { rawBody: makeEvent('evt_other', 'customer.created') },
      'run_e',
    );
    expect(outcome.accepted).toBe(true);
    expect(outcome.status).toBe('unknown');
    expect(outcome.sale).toBeNull();
  });

  it('createPaymentLink tanpa STRIPE_SECRET_KEY → error jelas', async () => {
    const sentinel = new StripeSentinel(secret);
    await expect(
      sentinel.createPaymentLink({ leadId: 'lead_1', amount: 29, currency: 'USD' }),
    ).rejects.toThrow('STRIPE_SECRET_KEY');
  });

  it('createPaymentLink memakai Payment Links API (harga inline, unit minor)', async () => {
    let captured: { url: string; body: string } | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      captured = { url: String(url), body: String(init?.body ?? '') };
      return new Response(JSON.stringify({ url: 'https://buy.stripe.com/test_abc' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const sentinel = new StripeSentinel(secret, { apiKey: 'sk_test_x', fetchImpl });
    const link = await sentinel.createPaymentLink({
      leadId: 'lead_2',
      amount: 29,
      currency: 'USD',
      productName: 'Invoice SaaS',
    });
    expect(link.checkoutUrl).toBe('https://buy.stripe.com/test_abc');
    expect(link.provider).toBe('stripe');
    expect(captured!.url).toBe('https://api.stripe.com/v1/payment_links');
    const body = decodeURIComponent(captured!.body);
    expect(body).toContain('unit_amount]=2900');
    expect(body).toContain('currency]=usd');
  });
});

/* ───────────── Midtrans (PRD §8 — market Indonesia) ───────────── */

function midtransNotification(over: Partial<MidtransNotification> = {}): MidtransNotification {
  return {
    order_id: 'order_1',
    status_code: '200',
    gross_amount: '29000.00',
    transaction_status: 'settlement',
    fraud_status: 'accept',
    transaction_id: 'trx_1',
    payment_type: 'qris',
    ...over,
  };
}

describe('Midtrans signature SHA-512 (PRD §8)', () => {
  const key = 'SB-Mid-server-test';

  it('signature valid diterima; gross_amount dimanipulasi ditolak', () => {
    const notif = midtransNotification();
    notif.signature_key = signMidtransNotification(notif, key);
    expect(verifyMidtransSignature(notif, key)).toBe(true);
    expect(verifyMidtransSignature({ ...notif, gross_amount: '1.00' }, key)).toBe(false);
    expect(verifyMidtransSignature(notif, 'SB-Mid-server-other')).toBe(false);
    expect(verifyMidtransSignature({ ...notif, signature_key: undefined }, key)).toBe(false);
  });

  it('parse transaction_time WIB (+07:00) dan ISO', () => {
    expect(parseMidtransTransactionTime('2016-06-25 07:31:05')).toBe(
      Date.parse('2016-06-25T07:31:05+07:00'),
    );
    expect(parseMidtransTransactionTime('2016-06-25T00:31:05Z')).toBe(
      Date.parse('2016-06-25T00:31:05Z'),
    );
    expect(parseMidtransTransactionTime(undefined)).toBeNull();
    expect(parseMidtransTransactionTime('not-a-time')).toBeNull();
  });
});

describe('Midtrans status mapping (PRD §7 Fase 9)', () => {
  it('settlement/capture/pending/expire/deny ternormalisasi', () => {
    expect(mapMidtransStatus('settlement')).toBe('settlement');
    expect(mapMidtransStatus('capture', 'accept')).toBe('settlement');
    expect(mapMidtransStatus('capture', 'challenge')).toBe('pending');
    expect(mapMidtransStatus('pending')).toBe('pending');
    expect(mapMidtransStatus('expire')).toBe('expiry');
    expect(mapMidtransStatus('deny')).toBe('deny');
    expect(mapMidtransStatus('cancel')).toBe('deny');
    expect(mapMidtransStatus('refund')).toBe('deny');
    expect(mapMidtransStatus('weird')).toBe('unknown');
  });
});

describe('MidtransSentinel — webhook & Snap (Fase 9)', () => {
  const key = 'SB-Mid-server-test';
  function signed(over: Partial<MidtransNotification> = {}): string {
    const notif = midtransNotification(over);
    notif.signature_key = signMidtransNotification(notif, key);
    return JSON.stringify(notif);
  }

  it('settlement → milestone IDR (paymentProvider midtrans) + idempoten', () => {
    const sentinel = new MidtransSentinel(key);
    const first = sentinel.receiveWebhook({ rawBody: signed() }, 'run_m');
    expect(first.accepted).toBe(true);
    expect(first.signatureVerified).toBe(true);
    expect(first.status).toBe('settlement');
    expect(first.sale?.paymentProvider).toBe('midtrans');
    expect(first.sale?.paymentEventId).toBe('trx_1');
    expect(first.sale?.amount).toBe(29000);
    expect(first.sale?.currency).toBe('IDR');
    expect(sentinel.metrics().salesCount).toBe(1);

    const second = sentinel.receiveWebhook({ rawBody: signed() }, 'run_m');
    expect(second.sale).toBeNull();
    expect(second.duplicate).toBe(true);
    expect(sentinel.metrics().salesCount).toBe(1);
  });

  it('signature invalid → ditolak tanpa mengubah metrik', () => {
    const sentinel = new MidtransSentinel(key);
    const forged = JSON.stringify(midtransNotification({ signature_key: 'deadbeef' }));
    const outcome = sentinel.receiveWebhook({ rawBody: forged }, 'run_m2');
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toBe('invalid-signature');
    expect(sentinel.metrics().salesCount).toBe(0);
  });

  it('notifikasi basi di luar tolerance ditolak (replay), yang segar diterima', () => {
    const sentinel = new MidtransSentinel(key);
    const old = new Date(Date.now() - (MIDTRANS_TOLERANCE_S + 3600) * 1000).toISOString();
    const stale = sentinel.receiveWebhook(
      { rawBody: signed({ order_id: 'order_old', transaction_time: old }) },
      'run_old',
    );
    expect(stale.accepted).toBe(false);
    expect(stale.reason).toBe('invalid-signature');

    const wibMs = new Date(Date.now() + 7 * 3600 * 1000);
    const p = (n: number): string => String(n).padStart(2, '0');
    const wib = `${wibMs.getUTCFullYear()}-${p(wibMs.getUTCMonth() + 1)}-${p(wibMs.getUTCDate())} ${p(wibMs.getUTCHours())}:${p(wibMs.getUTCMinutes())}:${p(wibMs.getUTCSeconds())}`;
    const ok = sentinel.receiveWebhook(
      {
        rawBody: signed({ order_id: 'order_ok', transaction_id: 'trx_ok', transaction_time: wib }),
      },
      'run_ok',
    );
    expect(ok.accepted).toBe(true);
    expect(ok.sale).not.toBeNull();
  });

  it('pending diekstrak sebagai status internal tanpa milestone', () => {
    const sentinel = new MidtransSentinel(key);
    const outcome = sentinel.receiveWebhook(
      { rawBody: signed({ transaction_status: 'pending' }) },
      'run_p',
    );
    expect(outcome.accepted).toBe(true);
    expect(outcome.status).toBe('pending');
    expect(outcome.sale).toBeNull();
  });

  it('tanpa serverKey (offline demo) notifikasi tetap diproses', () => {
    const sentinel = new MidtransSentinel(undefined);
    const outcome = sentinel.receiveWebhook(
      { rawBody: JSON.stringify(midtransNotification()) },
      'run_off',
    );
    expect(outcome.sale).not.toBeNull();
    expect(outcome.signatureVerified).toBe(false);
  });

  it('createPaymentLink memanggil Snap API & mengembalikan redirect_url', async () => {
    let captured: { url: string; init: RequestInit | undefined } | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      captured = { url: String(url), init };
      return new Response(
        JSON.stringify({
          token: 'snap-token',
          redirect_url: 'https://app.sandbox.midtrans.com/snap/v3/redirection/abc',
        }),
        { status: 201 },
      );
    }) as unknown as typeof fetch;
    const sentinel = new MidtransSentinel(key, { fetchImpl });
    const link = await sentinel.createPaymentLink({
      leadId: 'lead_9',
      amount: 290000,
      currency: 'IDR',
      customerEmail: 'buyer@demo.local',
      expiresInS: 3600,
    });
    expect(link.checkoutUrl).toContain('redirection/abc');
    expect(link.provider).toBe('midtrans');
    expect(link.expiresAt).toBeTruthy();
    expect(captured!.url).toBe('https://app.sandbox.midtrans.com/snap/v1/transactions');
    const headers = captured!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from(`${key}:`).toString('base64')}`);
    const body = JSON.parse(String(captured!.init?.body)) as {
      transaction_details: { order_id: string; gross_amount: number };
    };
    expect(body.transaction_details.gross_amount).toBe(290000);
    expect(body.transaction_details.order_id).toMatch(/^lead_9-/);
  });

  it('createPaymentLink tanpa serverKey → error jelas', async () => {
    await expect(
      new MidtransSentinel(undefined).createPaymentLink({
        leadId: 'l',
        amount: 1,
        currency: 'IDR',
      }),
    ).rejects.toThrow('MIDTRANS_SERVER_KEY');
  });
});

/* ───────────── Stub demo lokal (PRD §7 Fase 9) ───────────── */

describe('StubSentinel — demo tanpa akun gateway', () => {
  it('createPaymentLink → URL checkout lokal + peekLink', async () => {
    const stub = new StubSentinel({ demoBaseUrl: 'http://localhost:4800' });
    const link = await stub.createPaymentLink({
      leadId: 'lead_demo',
      amount: 290000,
      currency: 'IDR',
    });
    expect(link.checkoutUrl).toContain('http://localhost:4800/demo/checkout?order_id=');
    const orderId = new URL(link.checkoutUrl).searchParams.get('order_id') ?? '';
    expect(stub.peekLink(orderId)?.amount).toBe(290000);
  });

  it('demoNotification → settlement milestone provider stub', async () => {
    const stub = new StubSentinel();
    const link = await stub.createPaymentLink({
      leadId: 'lead_x',
      amount: 290000,
      currency: 'IDR',
    });
    const orderId = new URL(link.checkoutUrl).searchParams.get('order_id') ?? '';
    const notification = stub.demoNotification(orderId);
    expect(notification).not.toBeNull();

    const outcome = stub.receiveWebhook(notification!, 'demo');
    expect(outcome.sale?.paymentProvider).toBe('stub');
    expect(outcome.sale?.amount).toBe(290000);
    expect(outcome.sale?.currency).toBe('IDR');
    expect(stub.metrics().salesCount).toBe(1);

    // Replay idempoten — tidak ada milestone kedua.
    const again = stub.receiveWebhook(notification!, 'demo');
    expect(again.sale).toBeNull();
    expect(again.duplicate).toBe(true);
  });

  it('order tak dikenal ditolak tanpa mengubah metrik', () => {
    const stub = new StubSentinel();
    const outcome = stub.receiveWebhook(
      { rawBody: JSON.stringify({ order_id: 'stub_tidak_ada' }) },
      'demo',
    );
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toBe('unknown-order');
    expect(stub.metrics().salesCount).toBe(0);
  });

  it('simulateSale deterministik per eventId (resume run tidak ganda) — USD 29', () => {
    const stub = new StubSentinel();
    const first = stub.simulateSale('run_r', 'evt_run_r');
    const second = stub.simulateSale('run_r', 'evt_run_r');
    expect(first.sale?.amount).toBe(29);
    expect(first.sale?.currency).toBe('USD');
    expect(second.sale).toBeNull();
    expect(second.duplicate).toBe(true);
  });
});

/* ───────────── Xendit stub (opsional, Fase 11) ───────────── */

describe('XenditSentinel — interface siap, implementasi Fase 11', () => {
  it('melempar not implemented pada createPaymentLink & webhook', async () => {
    const xendit = new XenditSentinel('xnd_test');
    expect(xendit.id).toBe('xendit');
    await expect(
      xendit.createPaymentLink({ leadId: 'l', amount: 1, currency: 'IDR' }),
    ).rejects.toThrow('belum diimplementasikan');
    expect(() => xendit.receiveWebhook({ rawBody: '{}' }, 'run')).toThrow(
      'belum diimplementasikan',
    );
    expect(xendit.metrics().salesCount).toBe(0);
  });
});

/* ───────────── Factory createPayment + fail-fast config ───────────── */

describe('createPayment — resolusi driver (pola createLLM)', () => {
  it('tanpa kredensial → driver stub (offline demo)', () => {
    const payment = createPayment(loadConfig({ MEMORY_DRIVER: 'memory' }));
    expect(payment.id).toBe('stub');
    expect(payment.requiresSignature).toBe(false);
  });

  it('auto → stripe bila STRIPE_WEBHOOK_SECRET ada; midtrans bila server key ada', () => {
    const stripe = createPayment(
      loadConfig({ MEMORY_DRIVER: 'memory', STRIPE_WEBHOOK_SECRET: 'whsec_x' }),
    );
    expect(stripe.id).toBe('stripe');
    expect(stripe.requiresSignature).toBe(true);

    const midtrans = createPayment(
      loadConfig({
        MEMORY_DRIVER: 'memory',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
        MIDTRANS_SERVER_KEY: 'SB-Mid-server-x',
      }),
    );
    expect(midtrans.id).toBe('midtrans');
  });

  it('PAYMENT_DRIVER eksplisit tanpa kredensial → error saat boot (fail-fast)', () => {
    expect(() => loadConfig({ MEMORY_DRIVER: 'memory', PAYMENT_DRIVER: 'stripe' })).toThrow(
      'STRIPE_WEBHOOK_SECRET',
    );
    expect(() => loadConfig({ MEMORY_DRIVER: 'memory', PAYMENT_DRIVER: 'midtrans' })).toThrow(
      'MIDTRANS_SERVER_KEY',
    );
    expect(() => loadConfig({ MEMORY_DRIVER: 'memory', PAYMENT_DRIVER: 'xendit' })).toThrow(
      'XENDIT_SECRET_KEY',
    );
    expect(() => loadConfig({ MEMORY_DRIVER: 'memory', PAYMENT_DRIVER: 'stub' })).not.toThrow();
  });
});

describe('formatMoney lintas mata uang', () => {
  it('USD & IDR', () => {
    expect(formatMoney(29, 'USD')).toBe('$29.00');
    expect(formatMoney(290000, 'IDR')).toContain('290.000');
  });
});
