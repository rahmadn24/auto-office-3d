import { beforeEach, describe, expect, it } from 'vitest';

import type { ChatTurnPayload, InboxEntry, Lead, LeadUpdatePayload } from '../lib/events';
import { applyLeadUpdate, mergeEntries, mergeTurns, turnKey, useCsInbox } from '../store/csStore';

/**
 * Fase 11 — store CS Inbox: sinkronisasi lead (`lead:update`), preview pesan
 * terakhir, transkrip terpilih, dan state aksi (quote/sweep).
 * Fixture identik dengan brain/tests (paritas kontrak).
 */

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'lead_run_x_1',
    source: 'widget',
    contact: 'visitor-abc',
    name: 'Rina',
    interest: 'Kampanye: invoice generator',
    status: 'qualified',
    conversationId: 'cs:widget:visitor-abc',
    nextFollowupAt: '2026-01-02T00:00:00.000Z',
    followupsSent: 1,
    quote: {
      amount: 29,
      currency: 'USD',
      productName: 'Invoice Generator',
      checkoutUrl: 'https://brain.example/demo/checkout?order_id=stub_1',
      contractUrl: 'https://brain.example/cs/contracts/lead_run_x_1.pdf',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:05:00.000Z',
    ...over,
  };
}

function update(over: Partial<LeadUpdatePayload> = {}): LeadUpdatePayload {
  return { lead: lead(), reason: 'quote', timestamp: '2026-01-01T00:05:00.000Z', ...over };
}

function entry(over: Partial<Lead> = {}, extra: Partial<InboxEntry> = {}): InboxEntry {
  return { lead: lead(over), lastMessage: null, messageCount: 0, ...extra };
}

function turn(over: Partial<ChatTurnPayload> = {}): ChatTurnPayload {
  return {
    conversationId: 'cs:widget:visitor-abc',
    channel: 'cs_widget',
    role: 'agent',
    agentId: 'cs_agent',
    message: 'Halo! Ada yang bisa dibantu?',
    timestamp: '2026-01-01T00:05:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  useCsInbox.getState().reset();
});

describe('csStore — helper murni (Fase 11)', () => {
  it('mergeEntries upsert per lead id + urut updatedAt terbaru', () => {
    const older = entry({ id: 'lead_a', updatedAt: '2026-01-01T00:00:00.000Z' });
    const newer = entry({ id: 'lead_b', updatedAt: '2026-01-02T00:00:00.000Z', contact: 'b' });
    const merged = mergeEntries([older], [newer, entry({ id: 'lead_a', status: 'deal' })]);
    expect(merged.map((e) => e.lead.id)).toEqual(['lead_b', 'lead_a']);
    expect(merged[1]?.lead.status).toBe('deal');
  });

  it('applyLeadUpdate menyisipkan lead baru dan mempertahankan preview lama', () => {
    const existing = entry(
      {},
      { lastMessage: turn({ role: 'human', agentId: undefined }), messageCount: 4 },
    );
    const updated = applyLeadUpdate([existing], update({ lead: lead({ status: 'deal' }) }));
    expect(updated).toHaveLength(1);
    expect(updated[0]?.lead.status).toBe('deal');
    expect(updated[0]?.messageCount).toBe(4);

    const inserted = applyLeadUpdate(
      updated,
      update({ lead: lead({ id: 'lead_baru', contact: 'baru' }) }),
    );
    expect(inserted.map((e) => e.lead.id).sort()).toEqual(['lead_baru', 'lead_run_x_1']);
    expect(inserted.find((e) => e.lead.id === 'lead_baru')?.lastMessage).toBeNull();
  });

  it('mergeTurns dedupe by turnKey + urut timestamp', () => {
    const a = turn({ timestamp: '2026-01-01T00:00:02.000Z', message: 'kedua' });
    const b = turn({
      role: 'human',
      agentId: undefined,
      timestamp: '2026-01-01T00:00:01.000Z',
      message: 'pertama',
    });
    const merged = mergeTurns([a], [b, a]);
    expect(merged.map((t) => t.message)).toEqual(['pertama', 'kedua']);
    expect(turnKey(a)).toContain('kedua');
  });
});

describe('csStore — state inbox (Fase 11)', () => {
  it('setEntries merge + applyUpdate memperbarui status lead', () => {
    const store = useCsInbox.getState();
    store.setEntries([entry()]);
    store.applyUpdate(update({ lead: lead({ status: 'deal' }), reason: 'deal' }));
    const s = useCsInbox.getState();
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]?.lead.status).toBe('deal');
  });

  it('pushTurn menambah transkrip hanya untuk lead yang dipilih + update preview', () => {
    const store = useCsInbox.getState();
    store.setEntries([
      entry(),
      entry({ id: 'lead_lain', contact: 'lain', conversationId: 'cs:email:lain@x.id' }),
    ]);
    store.select('lead_run_x_1');
    store.pushTurn(turn({ role: 'human', agentId: undefined, message: 'berapa harga?' }));
    store.pushTurn(turn({ timestamp: '2026-01-01T00:05:01.000Z', message: 'Ini quote-nya' }));

    const s = useCsInbox.getState();
    expect(s.thread.map((t) => t.role)).toEqual(['human', 'agent']);
    expect(s.entries.find((e) => e.lead.id === 'lead_run_x_1')?.messageCount).toBe(2);
    // Turn percakapan lain tidak masuk transkrip lead terpilih.
    store.pushTurn(turn({ conversationId: 'cs:email:lain@x.id', message: 'thread lain' }));
    const after = useCsInbox.getState();
    expect(after.thread).toHaveLength(2);
    expect(after.entries.find((e) => e.lead.id === 'lead_lain')?.messageCount).toBe(1);
  });

  it('select mengganti lead aktif + reset transkrip sesi sebelumnya', () => {
    const store = useCsInbox.getState();
    store.setEntries([entry()]);
    store.select('lead_run_x_1');
    store.pushTurn(turn());
    expect(useCsInbox.getState().thread).toHaveLength(1);

    store.select('lead_lain');
    expect(useCsInbox.getState().selectedLeadId).toBe('lead_lain');
    expect(useCsInbox.getState().thread).toHaveLength(0);
  });

  it('applyPaymentLink menyimpan quote terakhir (tombol demo bayar/kontrak)', () => {
    useCsInbox.getState().applyPaymentLink({
      leadId: 'lead_run_x_1',
      provider: 'stub',
      checkoutUrl: 'https://brain.example/demo/checkout?order_id=stub_1',
      amount: 29,
      currency: 'USD',
      contractUrl: 'https://brain.example/cs/contracts/lead_run_x_1.pdf',
      timestamp: '2026-01-01T00:05:00.000Z',
    });
    const quote = useCsInbox.getState().lastQuote;
    expect(quote?.leadId).toBe('lead_run_x_1');
    expect(quote?.contractUrl).toContain('.pdf');

    useCsInbox.getState().setLastSweep({ checked: 3, sent: 2, templates: 1, lost: 1 });
    expect(useCsInbox.getState().lastSweep?.sent).toBe(2);
  });

  it('reset mengosongkan semua state (pindah tab / reconnect penuh)', () => {
    const store = useCsInbox.getState();
    store.setEntries([entry()]);
    store.select('lead_run_x_1');
    store.setLastError('gagal');
    store.reset();
    const s = useCsInbox.getState();
    expect(s.entries).toHaveLength(0);
    expect(s.selectedLeadId).toBeNull();
    expect(s.lastError).toBeNull();
  });
});
