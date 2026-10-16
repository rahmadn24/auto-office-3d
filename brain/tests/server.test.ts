import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';

import { loadConfig } from '../src/config';
import { EventBus } from '../src/events';
import { StripeSentinel, signStripePayload } from '../src/integrations';
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
      { ...loadConfig(), port: 0, socketPath: '/brain-hook', stripeWebhookSecret: secret },
      bus,
      { sentinel: new StripeSentinel(secret) },
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
});

describe('SIMULATE WEBHOOK via socket (kartu 💳)', () => {
  let client: ClientSocket;

  function connect(path: string): Promise<ClientSocket> {
    return new Promise((resolve) => {
      const c = connectClient(base, { path, transports: ['websocket'], reconnection: false });
      c.on('connect', () => resolve(c));
    });
  }

  it('stripe:simulate memancarkan milestone:first_sale + revenue:update ke klien', async () => {
    client = await connect('/brain-test');

    const sale = new Promise<FirstSalePayload>((resolve) =>
      client.once('milestone:first_sale', resolve),
    );
    const revenue = new Promise<RevenueUpdatePayload>((resolve) =>
      client.once('revenue:update', resolve),
    );

    const ack = await new Promise<{ ok: boolean; firstSale: boolean }>((resolve) => {
      client.emit('stripe:simulate', { runId: 'run_sim' }, resolve);
    });
    expect(ack.ok).toBe(true);
    expect(ack.firstSale).toBe(true);

    const salePayload = await sale;
    expect(salePayload.amount).toBe(29);
    expect(salePayload.hasCustomers).toBe(true);

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
