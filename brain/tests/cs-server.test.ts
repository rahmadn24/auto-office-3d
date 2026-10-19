import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';

import { loadConfig } from '../src/config';
import { LeadsStore } from '../src/cs/leads';
import { EventBus } from '../src/events';
import { StubEmail } from '../src/integrations/email';
import { StubLLM } from '../src/llm/stub';
import { HashEmbedder } from '../src/memory/embeddings';
import { InMemoryVectorStore } from '../src/memory/inMemory';
import { startSocketServer, type BrainServer } from '../src/server/socket';
import type { ChatTurnPayload, InboxEntry, LeadUpdatePayload } from '../src/types';

/**
 * Wiring Fase 11 end-to-end di level server (socket + HTTP):
 * widget/WA/email inbound → lead + balasan, quote → kontrak PDF → /demo/pay →
 * deal, follow-up sweep, dan aset widget yang disajikan Brain.
 */

let server: BrainServer;
let base: string;
let socket: ClientSocket;
let dataDir: string;
let leads: LeadsStore;

function emitAck<T>(event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 5000);
    const callback = (response: T) => {
      clearTimeout(timer);
      resolve(response);
    };
    // `state:request` ber-ack tunggal (tanpa payload); handler lain (input, ack).
    if (payload === undefined) socket.emit(event, callback);
    else socket.emit(event, payload, callback);
  });
}

function waitForEvent<T>(
  event: string,
  predicate: (payload: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onEvent = (payload: T) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timeout: ${event}`));
    }, timeoutMs);
    socket.on(event, onEvent);
  });
}

function waPayload(text: string): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ profile: { name: 'Budi WA' }, wa_id: '628111222333' }],
              messages: [
                {
                  from: '628111222333',
                  id: 'wamid.http1',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ao3d-cs-srv-'));
  leads = new LeadsStore(new Database(':memory:'));
  server = await startSocketServer(
    {
      ...loadConfig({
        DATA_DIR: dataDir,
        CS_FOLLOWUP_MS: '0',
        CS_PUBLIC_BASE_URL: 'http://localhost:4800',
      }),
      port: 0,
      socketPath: '/brain-cs',
      whatsappDriver: 'stub',
      whatsappVerifyToken: 'verify-123',
      emailInboundSecret: 's3cret',
    },
    new EventBus(),
    {
      leads,
      llm: new StubLLM(),
      memory: new InMemoryVectorStore(new HashEmbedder()),
      email: new StubEmail(),
    },
  );
  const address = server.httpServer.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;

  socket = connectClient(base, { path: '/brain-cs', transports: ['websocket'], forceNew: true });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 5000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
});

afterAll(async () => {
  socket?.close();
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('CS wiring via socket (Fase 11)', () => {
  it('system:hello menandai cs on + snapshot menyertakan array leads', async () => {
    expect(server.cs).toBeDefined();

    const res = await emitAck<{ ok: boolean; snapshot: { leads: InboxEntry[] } }>('state:request');
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.snapshot.leads)).toBe(true);
  });

  it('cs:widget_message → balasan agent cs_agent + lead muncul di cs:list/cs:history', async () => {
    const turnPromise = waitForEvent<ChatTurnPayload>(
      'cs:message',
      (turn) => turn.conversationId === 'cs:widget:vis_1' && turn.role === 'agent',
    );
    const ack = await emitAck<{ ok: boolean; queued: boolean }>('cs:widget_message', {
      visitorId: 'vis_1',
      name: 'Rina Widget',
      message: 'Halo, produk ini apa?',
    });
    expect(ack).toMatchObject({ ok: true, queued: true });
    const turn = await turnPromise;
    expect(turn.agentId).toBe('cs_agent');

    const list = await emitAck<{ ok: boolean; entries: InboxEntry[] }>('cs:list', {});
    const entry = list.entries.find((e) => e.lead.conversationId === 'cs:widget:vis_1');
    expect(entry?.lead.status).toBe('contacted');
    expect(entry?.lead.name).toBe('Rina Widget');
    expect(entry?.messageCount).toBe(2);

    const history = await emitAck<{ ok: boolean; turns: ChatTurnPayload[] }>('cs:history', {
      conversationId: 'cs:widget:vis_1',
    });
    expect(history.turns.map((t) => t.role)).toEqual(['human', 'agent']);
  });

  it('cs:quote → payment link + kontrak PDF bisa diunduh, /demo/pay menandai deal', async () => {
    const list = await emitAck<{ entries: InboxEntry[] }>('cs:list', {});
    const entry = list.entries.find((e) => e.lead.conversationId === 'cs:widget:vis_1');
    if (!entry) throw new Error('lead widget tidak ditemukan');
    const leadId = entry.lead.id;

    const dealPromise = waitForEvent<LeadUpdatePayload>(
      'lead:update',
      (payload) => payload.lead.id === leadId && payload.lead.status === 'deal',
    );

    const quote = await emitAck<{
      ok: boolean;
      lead: { status: string };
      link: { checkoutUrl: string; amount: number };
      contractUrl: string;
    }>('cs:quote', { leadId });
    expect(quote.ok).toBe(true);
    expect(quote.lead.status).toBe('qualified');
    expect(quote.link.checkoutUrl).toContain('/demo/checkout?order_id=stub_');

    // Kontrak PDF diunduh lewat HTTP (path dari contractUrl publik).
    const contractPath = new URL(quote.contractUrl).pathname;
    const pdfRes = await fetch(`${base}${contractPath}`);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get('content-type')).toBe('application/pdf');
    const pdf = Buffer.from(await pdfRes.arrayBuffer());
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');

    const missing = await fetch(`${base}/cs/contracts/lead_hantu.pdf`);
    expect(missing.status).toBe(404);

    // Bayar di halaman demo (stub) → webhook internal membawa leadId → markDeal.
    const checkout = new URL(quote.link.checkoutUrl);
    const orderId = checkout.searchParams.get('order_id') ?? '';
    const pay = await fetch(`${base}/demo/pay`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ order_id: orderId }).toString(),
    });
    expect(pay.status).toBe(200);

    const deal = await dealPromise;
    expect(deal.reason).toBe('deal');
    expect(deal.lead.status).toBe('deal');
  });

  it('cs:sweep force menjalankan follow-up engine untuk lead terbuka', async () => {
    const turnPromise = waitForEvent<ChatTurnPayload>(
      'cs:message',
      (turn) => turn.conversationId === 'cs:widget:vis_sweep' && turn.role === 'agent',
    );
    await emitAck('cs:widget_message', {
      visitorId: 'vis_sweep',
      message: 'Halo, saya lihat-lihat dulu ya',
    });
    await turnPromise;

    const swept = await emitAck<{
      ok: boolean;
      checked: number;
      sent: number;
      lost: number;
    }>('cs:sweep', { force: true });
    expect(swept.ok).toBe(true);
    expect(swept.checked).toBeGreaterThanOrEqual(1);
    expect(swept.sent).toBeGreaterThanOrEqual(1);
  });
});

describe('CS wiring via HTTP (Fase 11)', () => {
  it('GET /webhook/whatsapp memverifikasi challenge, POST inbound membuat lead WA', async () => {
    const ok = await fetch(
      `${base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=verify-123&hub.challenge=abc123`,
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('abc123');

    const wrong = await fetch(
      `${base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=salah&hub.challenge=x`,
    );
    expect(wrong.status).toBe(403);

    const res = await fetch(`${base}/webhook/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(waPayload('Halo dari WhatsApp')),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; handled: boolean; leadId?: string };
    expect(body).toMatchObject({ ok: true, handled: true });
    expect(body.leadId).toBeDefined();

    const lead = leads.getLead(body.leadId ?? '');
    expect(lead?.source).toBe('whatsapp');
    expect(lead?.name).toBe('Budi WA');
  });

  it('POST /webhook/email: secret wajib cocok (401), payload valid membuat lead email', async () => {
    const raw = new URLSearchParams({
      sender: 'Hans <hans@example.de>',
      subject: 'Demo',
      'body-plain': 'Bisa kirim demo?',
    }).toString();

    const noSecret = await fetch(`${base}/webhook/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: raw,
    });
    expect(noSecret.status).toBe(401);

    const ok = await fetch(`${base}/webhook/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-cs-inbound-secret': 's3cret',
      },
      body: raw,
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { ok: boolean; handled: boolean; leadId?: string };
    expect(body.ok).toBe(true);
    expect(leads.getLead(body.leadId ?? '')?.source).toBe('email');
  });

  it('aset widget + halaman demo disajikan Brain (tanpa CDN)', async () => {
    const widget = await fetch(`${base}/widget/widget.js`);
    expect(widget.status).toBe(200);
    expect(await widget.text()).toContain('AO3DWidget');

    const sock = await fetch(`${base}/widget/socket.io.min.js`);
    expect(sock.status).toBe(200);
    expect(sock.headers.get('content-type')).toContain('javascript');

    const demo = await fetch(`${base}/demo/widget`);
    expect(demo.status).toBe(200);
    const html = await demo.text();
    expect(html).toContain('/widget/widget.js');
  });
});
