import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';

import { loadConfig } from '../src/config';
import { EventBus } from '../src/events';
import {
  StripeSentinel,
  StubSentinel,
  XenditSentinel,
  signMidtransNotification,
  signStripePayload,
} from '../src/payments';
import { startSocketServer, type BrainServer } from '../src/server/socket';
import type { FirstSalePayload, RevenueUpdatePayload } from '../src/types';

let server: BrainServer;
let base: string;

beforeAll(async () => {
  server = await startSocketServer(
    { ...loadConfig(), port: 0, socketPath: '/brain-test' },
    new EventBus(),
  );
  const address = server.httpServer.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await server.close();
});

describe('server: health + Loop Controls HTTP endpoint', () => {
  it('GET /health menyertakan snapshot kontrol', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; control: { haltedAll: boolean } };
    expect(body.ok).toBe(true);
    expect(body.control.haltedAll).toBe(false);
  });

  it('POST /control/halt → GRAPH LOCKED di snapshot, /control/resume membukanya kembali', async () => {
    const halt = await fetch(`${base}/control/halt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(halt.status).toBe(200);
    const halted = (await halt.json()) as { control: { haltedAll: boolean } };
    expect(halted.control.haltedAll).toBe(true);

    const resume = await fetch(`${base}/control/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const resumed = (await resume.json()) as { control: { haltedAll: boolean; runIds: string[] } };
    expect(resumed.control.haltedAll).toBe(false);
    expect(resumed.control.runIds).toEqual([]);
  });

  it('POST /control/halt dengan runId spesifik hanya mengunci run itu', async () => {
    const halt = await fetch(`${base}/control/halt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run_targeted' }),
    });
    const body = (await halt.json()) as { control: { haltedAll: boolean; runIds: string[] } };
    expect(body.control.haltedAll).toBe(false);
    expect(body.control.runIds).toEqual(['run_targeted']);
    expect(server.control.isHalted('run_targeted')).toBe(true);
    expect(server.control.isHalted('run_other')).toBe(false);

    await fetch(`${base}/control/resume`, { method: 'POST', body: JSON.stringify({}) });
    expect(server.control.isHalted('run_targeted')).toBe(false);
  });

  it('endpoint tak dikenal → 404', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });
});

describe('Stripe Webhook Sentinel endpoint (PRD §3.4)', () => {
  it('POST /webhook/stripe memproses event & memancarkan milestone bila transaksi pertama', async () => {
    const bus = new EventBus();
    const secret = 'whsec_http';
    const srv = await startSocketServer(
      {
        ...loadConfig(),
        port: 0,
        socketPath: '/brain-hook',
        paymentDriver: 'stripe',
        stripeWebhookSecret: secret,
      },
      bus,
      { payment: new StripeSentinel(secret) },
    );
    const addr = srv.httpServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${addr.port}`;

    const received: FirstSalePayload[] = [];
    bus.onMilestone((p) => received.push(p));

    const event = {
      id: 'evt_http_1',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: { object: { amount_total: 2900, currency: 'usd', customer: 'cus_http' } },
    };
    const raw = JSON.stringify(event);
    const res = await fetch(`${url}/webhook/stripe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripePayload(raw, secret),
      },
      body: raw,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signatureVerified: boolean; firstSale: boolean };
    expect(body.signatureVerified).toBe(true);
    expect(body.firstSale).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]?.amount).toBe(29);

    // Webhook ganda (event id sama) idempoten → tak ada celebration kedua.
    const again = await fetch(`${url}/webhook/stripe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripePayload(raw, secret),
      },
      body: raw,
    });
    const againBody = (await again.json()) as { firstSale: boolean };
    expect(againBody.firstSale).toBe(false);
    expect(received).toHaveLength(1);

    await srv.close();
  });

  it('signature invalid → 401 tanpa memancarkan milestone (forged webhook ditolak)', async () => {
    const bus = new EventBus();
    const secret = 'whsec_http_bad';
    const srv = await startSocketServer(
      {
        ...loadConfig(),
        port: 0,
        socketPath: '/brain-hook',
        paymentDriver: 'stripe',
        stripeWebhookSecret: secret,
      },
      bus,
      { payment: new StripeSentinel(secret) },
    );
    const addr = srv.httpServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${addr.port}`;

    const received: FirstSalePayload[] = [];
    bus.onMilestone((p) => received.push(p));

    const raw = JSON.stringify({
      id: 'evt_forged',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: { object: { amount_total: 2900, currency: 'usd', customer: 'cus_forged' } },
    });
    const res = await fetch(`${url}/webhook/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
      body: raw,
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { firstSale: boolean; signatureVerified: boolean };
    expect(body.firstSale).toBe(false);
    expect(body.signatureVerified).toBe(false);
    expect(received).toHaveLength(0);

    await srv.close();
  });
});

describe('SIMULATE WEBHOOK via socket (kartu 💳)', () => {
  let client: ClientSocket;

  function connect(path: string): Promise<ClientSocket> {
    return new Promise((resolve) => {
      const c = connectClient(base, { path, transports: ['websocket'], reconnection: false });
      c.on('connect', () => resolve(c));
    });
  }

  it('payment:simulate memancarkan milestone:first_sale + revenue:update ke klien', async () => {
    client = await connect('/brain-test');

    const sale = new Promise<FirstSalePayload>((resolve) =>
      client.once('milestone:first_sale', resolve),
    );
    const revenue = new Promise<RevenueUpdatePayload>((resolve) =>
      client.once('revenue:update', resolve),
    );

    const ack = await new Promise<{ ok: boolean; firstSale: boolean; provider: string }>(
      (resolve) => {
        client.emit('payment:simulate', { runId: 'run_sim' }, resolve);
      },
    );
    expect(ack.ok).toBe(true);
    expect(ack.firstSale).toBe(true);
    expect(ack.provider).toBe('stub');

    const salePayload = await sale;
    expect(salePayload.amount).toBe(29);
    expect(salePayload.hasCustomers).toBe(true);
    expect(salePayload.paymentProvider).toBe('stub');

    const rev = await revenue;
    expect(rev.salesCount).toBeGreaterThanOrEqual(1);
    expect(rev.grossRevenueArr).toBeGreaterThanOrEqual(29);
    client.close();
  });
});

describe('Broadcast deploy:update & social:post (Fase 4)', () => {
  it('klien menerima update deployment & post kampanye dari bus', async () => {
    const bus = new EventBus();
    const srv = await startSocketServer(
      { ...loadConfig(), port: 0, socketPath: '/brain-int' },
      bus,
    );
    const addr = srv.httpServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${addr.port}`;

    const client = await new Promise<ClientSocket>((resolve) => {
      const c = connectClient(url, {
        path: '/brain-int',
        transports: ['websocket'],
        reconnection: false,
      });
      c.on('connect', () => resolve(c));
    });

    const deploy = new Promise<{ status: string; liveUrl: string }>((resolve) =>
      client.once('deploy:update', resolve),
    );
    const social = new Promise<{ platform: string; status: string }>((resolve) =>
      client.once('social:post', resolve),
    );

    bus.deploy({
      runId: 'r1',
      repoName: 'x',
      repoUrl: 'https://github.com/autooffice3d/x',
      liveUrl: 'x.vercel.app',
      status: 'ready',
      buildSteps: [],
      health: { rootOk: true, apiOk: true, sslValid: true, ttfbMs: 20 },
      uptimeS: 0,
      bandwidthMb: 0.12,
      edgeCache: true,
      timestamp: new Date().toISOString(),
    });
    bus.social({
      runId: 'r1',
      platform: 'x',
      status: 'published',
      queueId: 'q_1',
      thread: ['h'],
      hook: 'h',
      metrics: { impressions: 10, clicks: 1, retweets: 0 },
      sentiment: 'positive',
      timestamp: new Date().toISOString(),
    });

    expect((await deploy).status).toBe('ready');
    expect((await social).platform).toBe('x');
    client.close();
    await srv.close();
  });
});

/* ───────── Fase 9 — Payment Abstraction: HTTP stub & midtrans ───────── */

describe('Stub payment driver — demo checkout lokal (Fase 9)', () => {
  it('create link → GET /demo/checkout → POST /demo/pay → milestone + revenue', async () => {
    const bus = new EventBus();
    const stub = new StubSentinel({ demoBaseUrl: 'http://localhost:0' });
    const srv = await startSocketServer(
      { ...loadConfig(), port: 0, socketPath: '/brain-demo' },
      bus,
      { payment: stub },
    );
    const addr = srv.httpServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${addr.port}`;

    const milestones: FirstSalePayload[] = [];
    bus.onMilestone((p) => milestones.push(p));
    const revenue = new Promise<RevenueUpdatePayload>((resolve) => bus.onRevenue(resolve));

    const link = await stub.createPaymentLink({
      leadId: 'lead_http',
      amount: 290000,
      currency: 'IDR',
    });
    const orderId = new URL(link.checkoutUrl).searchParams.get('order_id') ?? '';
    expect(orderId).not.toBe('');

    const page = await fetch(`${url}/demo/checkout?order_id=${encodeURIComponent(orderId)}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Demo Checkout');

    const pay = await fetch(`${url}/demo/pay`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `order_id=${encodeURIComponent(orderId)}`,
    });
    expect(pay.status).toBe(200);
    const html = await pay.text();
    expect(html).toContain('FIRST CUSTOMER ACQUIRED');

    expect(milestones).toHaveLength(1);
    expect(milestones[0]?.paymentProvider).toBe('stub');
    expect(milestones[0]?.amount).toBe(290000);
    expect(milestones[0]?.currency).toBe('IDR');

    const rev = await revenue;
    expect(rev.salesCount).toBe(1);

    // Health endpoint menyertakan status payment sentinel aktif.
    const health = (await (await fetch(`${url}/health`)).json()) as {
      payment: { provider: string; salesCount: number };
    };
    expect(health.payment.provider).toBe('stub');
    expect(health.payment.salesCount).toBe(1);

    await srv.close();
  });

  it('order tak dikenal → 404 pada /demo/checkout', async () => {
    const srv = await startSocketServer(
      { ...loadConfig(), port: 0, socketPath: '/brain-demo2' },
      new EventBus(),
    );
    const addr = srv.httpServer.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/demo/checkout?order_id=nope`);
    expect(res.status).toBe(404);
    await srv.close();
  });
});

describe('Midtrans webhook HTTP (Fase 9)', () => {
  it('notifikasi signed → 200 + milestone IDR; signature salah → 401', async () => {
    const bus = new EventBus();
    const key = 'SB-Mid-server-http';
    const srv = await startSocketServer(
      {
        ...loadConfig(),
        port: 0,
        socketPath: '/brain-mdt',
        paymentDriver: 'midtrans',
        midtransServerKey: key,
      },
      bus,
    );
    const addr = srv.httpServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${addr.port}`;

    const milestones: FirstSalePayload[] = [];
    bus.onMilestone((p) => milestones.push(p));

    const notif = {
      order_id: 'order_http',
      status_code: '200',
      gross_amount: '29000.00',
      transaction_status: 'settlement',
      transaction_id: 'trx_http',
      currency: 'IDR',
    };
    const raw = JSON.stringify({
      ...notif,
      signature_key: signMidtransNotification(notif, key),
    });
    const res = await fetch(`${url}/webhook/midtrans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { firstSale: boolean; provider: string; status: string };
    expect(body.firstSale).toBe(true);
    expect(body.provider).toBe('midtrans');
    expect(body.status).toBe('settlement');
    expect(milestones).toHaveLength(1);
    expect(milestones[0]?.currency).toBe('IDR');
    expect(milestones[0]?.paymentProvider).toBe('midtrans');

    const forged = await fetch(`${url}/webhook/midtrans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...notif, order_id: 'order_forged', signature_key: 'deadbeef' }),
    });
    expect(forged.status).toBe(401);
    const forgedBody = (await forged.json()) as { firstSale: boolean };
    expect(forgedBody.firstSale).toBe(false);
    expect(milestones).toHaveLength(1);

    await srv.close();
  });

  it('driver xendit belum diimplementasikan → /webhook/xendit 501', async () => {
    const srv = await startSocketServer(
      {
        ...loadConfig(),
        port: 0,
        socketPath: '/brain-xnd',
        paymentDriver: 'xendit',
        xenditSecretKey: 'xnd_test',
      },
      new EventBus(),
      { payment: new XenditSentinel('xnd_test') },
    );
    const addr = srv.httpServer.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/webhook/xendit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(501);
    await srv.close();
  });
});
