import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EmailChannelAdapter, WhatsAppAdapter, WidgetAdapter } from '../src/cs/channels';
import { LeadsStore } from '../src/cs/leads';
import { CsService } from '../src/cs/service';
import { StubEmail } from '../src/integrations/email';
import { StubLLM } from '../src/llm/stub';
import { HashEmbedder } from '../src/memory/embeddings';
import { InMemoryVectorStore } from '../src/memory/inMemory';
import type { PaymentLinkPayload } from '../src/payments/provider';
import { StubSentinel } from '../src/payments/stub';
import type { ChatTurnPayload, LeadUpdatePayload } from '../src/types';

/**
 * CS Service (Fase 11 — PRD §3.5): omnichannel inbound → lead + balasan,
 * quote/closing flow (payment link + kontrak PDF), follow-up engine, dan
 * penandaan deal dari settlement. Semua driver stub — deterministik & offline.
 */

interface Harness {
  service: CsService;
  store: LeadsStore;
  memory: InMemoryVectorStore;
  email: StubEmail;
  events: Array<{ event: string; payload: unknown }>;
  cleanup(): void;
}

function harness(
  overrides: {
    inboundSecret?: string;
    followupDelayMs?: number;
    maxFollowups?: number;
  } = {},
): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'ao3d-cs-'));
  const store = new LeadsStore(new Database(':memory:'));
  const memory = new InMemoryVectorStore(new HashEmbedder());
  const email = new StubEmail();
  const events: Array<{ event: string; payload: unknown }> = [];
  const service = new CsService({
    store,
    memory,
    llm: new StubLLM(),
    payment: new StubSentinel({ demoBaseUrl: 'http://localhost:4800' }),
    email,
    adapters: {
      widget: new WidgetAdapter(),
      whatsapp: new WhatsAppAdapter({ driver: 'stub', verifyToken: 'vt' }),
      email: new EmailChannelAdapter({
        email,
        ...(overrides.inboundSecret ? { inboundSecret: overrides.inboundSecret } : {}),
      }),
    },
    broadcast: (event, payload) => events.push({ event, payload }),
    contractsDir: join(dir, 'contracts'),
    publicBaseUrl: 'http://localhost:4800',
    followupDelayMs: overrides.followupDelayMs ?? 1000,
    maxFollowups: overrides.maxFollowups ?? 3,
    defaultProductName: 'Invoice Generator',
  });
  return {
    service,
    store,
    memory,
    email,
    events,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function reasons(h: Harness): string[] {
  return h.events
    .filter((e) => e.event === 'lead:update')
    .map((e) => (e.payload as LeadUpdatePayload).reason);
}

describe('CsService — inbound omnichannel → lead + balasan (Fase 11)', () => {
  it('pesan widget membuat lead, transkrip dua arah, dan broadcast lead/cs', async () => {
    const h = harness();
    try {
      const result = await h.service.handleInbound({
        channel: 'widget',
        contact: 'w_1',
        name: 'Rina',
        text: 'Halo, produk ini apa?',
      });
      expect(result).not.toBeNull();
      const lead = result?.lead;
      if (!lead) throw new Error('lead tidak terbentuk');
      expect(lead.source).toBe('widget');
      expect(lead.name).toBe('Rina');
      expect(lead.status).toBe('contacted');

      const messages = h.store.listMessages(lead.conversationId);
      expect(messages.map((m) => m.role)).toEqual(['human', 'agent']);
      expect(messages[0]?.message).toBe('Halo, produk ini apa?');
      expect(messages[1]?.agent).toBe('cs_agent');
      expect(messages[1]?.meta?.mode).toBe('direct'); // widget adapter selalu online
      expect(result?.reply.agentId).toBe('cs_agent');

      expect(reasons(h)).toEqual(['created', 'message']);
      const broadcast = h.events.find(
        (e) => e.event === 'cs:message' && (e.payload as ChatTurnPayload).role === 'agent',
      );
      expect(broadcast).toBeDefined();
    } finally {
      h.cleanup();
    }
  });

  it('id pesan provider sama (retry webhook) tidak dobel-balas', async () => {
    const h = harness();
    try {
      const first = await h.service.handleInbound({
        channel: 'whatsapp',
        contact: '628123',
        text: 'halo',
        providerMessageId: 'wamid.1',
      });
      const second = await h.service.handleInbound({
        channel: 'whatsapp',
        contact: '628123',
        text: 'halo',
        providerMessageId: 'wamid.1',
      });
      expect(second).toBeNull();
      expect(first).not.toBeNull();
      expect(h.store.messageCount(first?.lead.conversationId ?? '')).toBe(2);
    } finally {
      h.cleanup();
    }
  });

  it('WhatsApp di luar jendela 24 jam → outbound memakai template HSM', async () => {
    const h = harness();
    try {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const result = await h.service.handleInbound({
        channel: 'whatsapp',
        contact: '628999',
        text: 'Halo, masih ada?',
        timestamp: old,
      });
      const messages = h.store.listMessages(result?.lead.conversationId ?? '');
      const agent = messages.find((m) => m.role === 'agent');
      expect(agent?.meta?.mode).toBe('template');
      expect(String(agent?.meta?.outboundId)).toContain('wa_stub_');
    } finally {
      h.cleanup();
    }
  });

  it('turn human & sumber lead ikut direcall ke vector memory (briefing + leads)', async () => {
    const h = harness();
    try {
      const result = await h.service.handleInbound({
        channel: 'email',
        contact: 'rina@example.com',
        text: 'Saya butuh invoice generator untuk tim finance.',
      });
      // upsert vector berjalan fire-and-forget — beri kesempatan microtask selesai.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const briefing = await h.memory.search('briefing', 'invoice generator', 10);
      const leads = await h.memory.search('leads', 'invoice generator', 10);
      expect(briefing.length).toBeGreaterThan(0);
      expect(leads.length).toBeGreaterThan(0);
      expect(leads[0]?.metadata?.source).toBe('email');
      expect(result?.lead.source).toBe('email');
    } finally {
      h.cleanup();
    }
  });
});

describe('CsService — closing flow: quote → payment link → kontrak PDF (Fase 11)', () => {
  it('niat beli → quote otomatis sekali kirim (link + kontrak + status qualified)', async () => {
    const h = harness();
    try {
      const result = await h.service.handleInbound({
        channel: 'widget',
        contact: 'w_buy',
        text: 'Berapa harganya? Saya mau berlangganan.',
      });
      const lead = h.store.getLead(result?.lead.id ?? '');
      if (!lead) throw new Error('lead hilang');
      expect(lead.status).toBe('qualified');
      expect(lead.quote?.amount).toBe(29);
      expect(lead.quote?.currency).toBe('USD');
      expect(lead.quote?.checkoutUrl).toContain('/demo/checkout?order_id=stub_');

      const pdf = readFileSync(h.service.contractPath(lead.id));
      expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
      expect(pdf.toString('latin1')).toContain('KONTRAK LAYANAN DIGITAL');

      // Hanya SATU balasan agent (auto-quote & balasan tidak dobel).
      const agentTurns = h.store
        .listMessages(lead.conversationId)
        .filter((m) => m.role === 'agent');
      expect(agentTurns).toHaveLength(1);
      expect(agentTurns[0]?.message).toContain('Quote resmi');
      expect(agentTurns[0]?.message).toContain('$29.00');

      const linkEvent = h.events.find((e) => e.event === 'payment:link_created');
      const linkPayload = linkEvent?.payload as PaymentLinkPayload | undefined;
      expect(linkPayload?.contractUrl).toBe(
        `${'http://localhost:4800'}/cs/contracts/${lead.id}.pdf`,
      );
      expect(reasons(h)).toContain('quote');
    } finally {
      h.cleanup();
    }
  });

  it('quote eksplisit (aksi inbox) mendukung amount/currency/produk override + kirim email', async () => {
    const h = harness();
    try {
      const lead = h.store.createLead({
        source: 'email',
        contact: 'hans@example.de',
        name: 'Hans',
        interest: 'paket tahunan',
      });
      const quote = await h.service.quote(lead.id, {
        amount: 450_000,
        currency: 'IDR',
        productName: 'Paket Tahunan',
      });
      expect(quote.ok).toBe(true);
      if (!quote.ok) throw new Error('quote gagal');
      expect(quote.lead.status).toBe('qualified');
      expect(quote.link.amount).toBe(450_000);
      expect(quote.contractUrl).toBe(`http://localhost:4800/cs/contracts/${lead.id}.pdf`);

      expect(h.email.sent.at(-1)?.to).toBe('hans@example.de');
      expect(h.email.sent.at(-1)?.subject).toContain('Paket Tahunan');
      const turns = h.store.listMessages(lead.conversationId);
      expect(turns.filter((m) => m.role === 'agent')).toHaveLength(1);
      expect(turns.at(-1)?.message).toContain('Rp 450.000');
      expect(turns.at(-1)?.meta?.kind).toBe('quote');

      h.store.updateLead(lead.id, { status: 'lost' });
      const afterLost = await h.service.quote(lead.id, {});
      expect(afterLost).toEqual({ ok: false, error: 'lead sudah lost' });
      const missing = await h.service.quote('lead_hantu', {});
      expect(missing.ok).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  it('markDeal: settlement → status deal, ucapan terima kasih, ringkasan ke pm-memory', async () => {
    const h = harness();
    try {
      const lead = h.store.createLead({ source: 'widget', contact: 'w_deal', name: 'Rina' });
      await h.service.markDeal(lead.id, { amount: 29, currency: 'USD', provider: 'stub' });

      const updated = h.store.getLead(lead.id);
      expect(updated?.status).toBe('deal');
      expect(updated?.nextFollowupAt).toBeNull();
      expect(reasons(h)).toEqual(['deal']);
      const turns = h.store.listMessages(lead.conversationId);
      expect(turns.at(-1)?.meta?.kind).toBe('deal');
      expect(turns.at(-1)?.message).toContain('Pembayaran diterima');

      const hits = await h.memory.search('pm-memory', 'deal Rina', 5);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.text).toContain('Deal Rina');
      expect(hits[0]?.metadata?.kind).toBe('deal');

      // Idempoten: deal kedua tidak menambah pesan / broadcast.
      await h.service.markDeal(lead.id, { amount: 29, currency: 'USD', provider: 'stub' });
      expect(h.store.messageCount(lead.conversationId)).toBe(1);
      expect(reasons(h)).toEqual(['deal']);
    } finally {
      h.cleanup();
    }
  });
});

describe('CsService — follow-up engine (Fase 11)', () => {
  it('sweep default hanya menyentuh lead yang jatuh tempo', async () => {
    const h = harness();
    try {
      h.store.createLead({
        source: 'email',
        contact: 'future@example.com',
        nextFollowupAt: '2099-01-01T00:00:00.000Z',
      });
      const sweep = await h.service.sweep();
      expect(sweep.checked).toBe(0);
      expect(sweep.sent).toBe(0);
    } finally {
      h.cleanup();
    }
  });

  it('sweep force mengirim follow-up berulang lalu menandai lost setelah batas', async () => {
    const h = harness({ maxFollowups: 2 });
    try {
      const result = await h.service.handleInbound({
        channel: 'widget',
        contact: 'w_sweep',
        text: 'Tanya-tanya dulu ya',
      });
      const leadId = result?.lead.id ?? '';

      const first = await h.service.sweep({ force: true });
      expect(first.sent).toBe(1);
      expect(h.store.getLead(leadId)?.followupsSent).toBe(1);

      const second = await h.service.sweep({ force: true });
      expect(second.sent).toBe(1);
      expect(h.store.getLead(leadId)?.followupsSent).toBe(2);

      const third = await h.service.sweep({ force: true });
      expect(third.sent).toBe(0);
      expect(third.lost).toBe(1);
      expect(h.store.getLead(leadId)?.status).toBe('lost');
      expect(h.store.getLead(leadId)?.nextFollowupAt).toBeNull();
      expect(reasons(h)).toContain('status');
    } finally {
      h.cleanup();
    }
  });

  it('follow-up lead qualified menyertakan quote, checkout, dan kontrak', async () => {
    const h = harness();
    try {
      const result = await h.service.handleInbound({
        channel: 'email',
        contact: 'buyer@example.com',
        text: 'berapa harga paketnya?',
      });
      const leadId = result?.lead.id ?? '';
      const sweep = await h.service.sweep({ force: true });
      expect(sweep.sent).toBe(1);
      const turns = h.store.listMessages(result?.lead.conversationId ?? '');
      const followup = turns.find((m) => m.meta?.kind === 'followup');
      expect(followup?.message).toContain('Reminder');
      expect(followup?.message).toContain('Bayar: ');
      expect(followup?.message).toContain('/cs/contracts/');
      expect(h.store.getLead(leadId)?.followupsSent).toBe(1);
    } finally {
      h.cleanup();
    }
  });
});

describe('CsService — webhook inbound adapter (Fase 11)', () => {
  it('email inbound: secret terpasang wajib cocok, payload rusak ditolak', async () => {
    const h = harness({ inboundSecret: 's3cret' });
    try {
      const raw = new URLSearchParams({
        sender: 'Rina <rina@example.com>',
        subject: 'Halo CS',
        'body-plain': 'Bisa kirim demo?',
      }).toString();

      const noSecret = await h.service.handleEmailInbound({
        rawBody: raw,
        headers: {},
        contentType: 'application/x-www-form-urlencoded',
      });
      expect(noSecret).toEqual({ ok: false, error: 'invalid-secret' });

      const ok = await h.service.handleEmailInbound({
        rawBody: raw,
        headers: { 'x-cs-inbound-secret': 's3cret' },
        contentType: 'application/x-www-form-urlencoded',
      });
      expect(ok.ok).toBe(true);
      if (ok.ok) expect(ok.handled).toBe(true);
      expect(h.store.listLeads()[0]?.source).toBe('email');

      const broken = await h.service.handleEmailInbound({
        rawBody: '{}',
        headers: { 'x-cs-inbound-secret': 's3cret' },
        contentType: 'application/json',
      });
      expect(broken).toEqual({ ok: false, error: 'invalid-payload' });
    } finally {
      h.cleanup();
    }
  });

  it('registerLead (handoff Marketer) idempoten dan memancarkan lead:update', async () => {
    const h = harness();
    try {
      const first = h.service.registerLead({
        id: 'lead_run_x_1',
        source: 'email',
        contact: 'Lead+Run_1@Demo.local',
        interest: 'Kampanye invoice generator',
      });
      expect(first.status).toBe('new');
      const again = h.service.registerLead({
        id: 'lead_run_x_1',
        source: 'email',
        contact: 'Lead+Run_1@Demo.local',
      });
      expect(again.id).toBe(first.id);
      expect(reasons(h)).toEqual(['created', 'message']);
      expect(h.store.listLeads()).toHaveLength(1);
    } finally {
      h.cleanup();
    }
  });
});
