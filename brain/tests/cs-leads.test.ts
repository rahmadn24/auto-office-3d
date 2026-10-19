import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import {
  conversationIdFor,
  LeadsStore,
  messageToTurn,
  type CsMessageRecord,
} from '../src/cs/leads';

/**
 * Leads store — mini-CRM durable (Fase 11, PRD §3.5): skema Lead + transkrip
 * omnichannel, dasar CS Inbox & follow-up engine.
 */

function makeStore(): LeadsStore {
  return new LeadsStore(new Database(':memory:'));
}

describe('LeadsStore — lead & transkrip durable (Fase 11)', () => {
  it('createLead idempoten per conversation dan melengkapi name/interest kosong', () => {
    const store = makeStore();
    const first = store.createLead({
      source: 'widget',
      contact: 'w_abc123',
      interest: 'harga paket',
    });
    expect(first.source).toBe('widget');
    expect(first.status).toBe('new');
    expect(first.conversationId).toBe('cs:widget:w_abc123');
    expect(first.followupsSent).toBe(0);
    expect(first.quote).toBeNull();

    const again = store.createLead({
      source: 'widget',
      contact: 'w_abc123',
      name: 'Rina',
      interest: 'harga paket lengkap',
    });
    expect(again.id).toBe(first.id);
    expect(again.name).toBe('Rina');
    // Interest lama dipertahankan (tidak menimpa konteks awal).
    expect(again.interest).toBe('harga paket');
    expect(store.listLeads()).toHaveLength(1);
  });

  it('id deterministik (handoff Marketer) tidak menduplikasi lead saat run di-resume', () => {
    const store = makeStore();
    const input = {
      id: 'lead_run_1_1',
      source: 'email' as const,
      contact: 'lead+run_1@demo.local',
      interest: 'Kampanye invoice generator',
    };
    const a = store.createLead(input);
    const b = store.createLead(input);
    expect(b.id).toBe(a.id);
    expect(store.listLeads()).toHaveLength(1);
    expect(store.getLead('lead_run_1_1')?.conversationId).toBe('cs:email:lead+run_1@demo.local');
  });

  it('listLeads urut perubahan terbaru; openLeads hanya status hidup', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const store = makeStore();
      const a = store.createLead({ source: 'widget', contact: 'a' });
      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
      const b = store.createLead({ source: 'email', contact: 'b' });
      vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));
      store.updateLead(a.id, { status: 'deal' });
      vi.setSystemTime(new Date('2026-01-01T00:00:03.000Z'));
      store.updateLead(b.id, { status: 'qualified' });

      expect(store.listLeads().map((l) => l.id)).toEqual([b.id, a.id]);
      expect(store.openLeads().map((l) => l.id)).toEqual([b.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dueFollowups hanya mengambil lead hidup dengan next_followup_at terlewat', () => {
    const store = makeStore();
    const due = store.createLead({
      source: 'widget',
      contact: 'due',
      nextFollowupAt: '2026-01-01T00:00:00.000Z',
    });
    store.createLead({
      source: 'widget',
      contact: 'future',
      nextFollowupAt: '2099-01-01T00:00:00.000Z',
    });
    store.createLead({ source: 'widget', contact: 'no-date' });
    const lost = store.createLead({
      source: 'widget',
      contact: 'lost',
      nextFollowupAt: '2026-01-01T00:00:00.000Z',
    });
    store.updateLead(lost.id, { status: 'lost' });

    const found = store.dueFollowups('2026-06-01T00:00:00.000Z');
    expect(found.map((l) => l.id)).toEqual([due.id]);
  });

  it('updateLead menyimpan quote JSON + counter follow-up durable', () => {
    const store = makeStore();
    const lead = store.createLead({ source: 'whatsapp', contact: '+6281234567890' });
    const updated = store.updateLead(lead.id, {
      status: 'qualified',
      followupsSent: 2,
      quote: {
        amount: 29,
        currency: 'USD',
        productName: 'Invoice Generator',
        checkoutUrl: 'http://localhost:4800/demo/checkout?order_id=x',
        contractUrl: 'http://localhost:4800/cs/contracts/x.pdf',
      },
    });
    expect(updated?.status).toBe('qualified');
    expect(updated?.followupsSent).toBe(2);
    expect(updated?.quote?.amount).toBe(29);

    // Rehidrasi dari SQLite (bukan cache objek) — quote tetap utuh.
    const reloaded = store.getLead(lead.id);
    expect(reloaded?.quote?.productName).toBe('Invoice Generator');
    expect(store.updateLead('lead_tidak_ada', { status: 'lost' })).toBeNull();
  });

  it('appendMessage/listMessages kronologis + meta JSON + messageToTurn', () => {
    const store = makeStore();
    const lead = store.createLead({ source: 'email', contact: 'hans@example.com' });
    store.appendMessage({
      conversationId: lead.conversationId,
      leadId: lead.id,
      channel: 'cs_email',
      role: 'human',
      message: 'Halo, ada demo?',
      ts: '2026-01-01T00:00:00.000Z',
    });
    store.appendMessage({
      conversationId: lead.conversationId,
      leadId: lead.id,
      channel: 'cs_email',
      role: 'agent',
      agent: 'cs_agent',
      message: 'Tentu, ini tautannya.',
      meta: { citations: ['pm-memory[x]: harga $29'], mode: 'stub' },
      ts: '2026-01-01T00:00:05.000Z',
    });
    store.appendMessage({
      conversationId: 'cs:widget:lain',
      channel: 'cs_widget',
      role: 'human',
      message: 'thread lain',
    });

    const messages = store.listMessages(lead.conversationId);
    expect(messages.map((m) => m.role)).toEqual(['human', 'agent']);
    expect(store.messageCount(lead.conversationId)).toBe(2);
    const agent = messages[1] as CsMessageRecord;
    expect(agent.meta?.mode).toBe('stub');

    const turn = messageToTurn(agent);
    expect(turn.agentId).toBe('cs_agent');
    expect(turn.citations).toEqual(['pm-memory[x]: harga $29']);
    expect(turn.channel).toBe('cs_email');

    const humanTurn = messageToTurn(messages[0] as CsMessageRecord);
    expect(humanTurn.agentId).toBeUndefined();
  });

  it('lastHumanMessageAt hanya menghitung pesan client (guard 24 jam WhatsApp)', () => {
    const store = makeStore();
    const lead = store.createLead({ source: 'whatsapp', contact: '+62811' });
    expect(store.lastHumanMessageAt(lead.conversationId)).toBeNull();
    store.appendMessage({
      conversationId: lead.conversationId,
      channel: 'cs_whatsapp',
      role: 'agent',
      message: 'balasan agent',
      ts: '2026-02-01T10:00:00.000Z',
    });
    store.appendMessage({
      conversationId: lead.conversationId,
      channel: 'cs_whatsapp',
      role: 'human',
      message: 'pesan client',
      ts: '2026-02-01T09:00:00.000Z',
    });
    expect(store.lastHumanMessageAt(lead.conversationId)).toBe('2026-02-01T09:00:00.000Z');
  });

  it('conversationIdFor menormalkan kontak lintas channel', () => {
    expect(conversationIdFor('email', 'Hans.Müller@Example.COM')).toBe(
      'cs:email:hans.m-ller@example.com',
    );
    expect(conversationIdFor('whatsapp', '+62 812-3456')).toBe('cs:whatsapp:+62-812-3456');
    expect(conversationIdFor('widget', 'W_ABC 123')).toBe('cs:widget:w_abc-123');
  });
});
