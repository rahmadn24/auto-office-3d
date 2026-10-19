import { create } from 'zustand';

import type {
  ChatTurnPayload,
  InboxEntry,
  LeadUpdatePayload,
  PaymentLinkPayload,
} from '@/lib/events';

/**
 * CS INBOX store (Fase 11 — PRD §3.5): ringkasan lead omnichannel + transkrip
 * percakapan yang dipilih. Sumber kebenaran ada di Brain (SQLite `leads` +
 * `cs_messages`); store ini cache UI yang disinkronkan lewat `lead:update`,
 * `cs:message`, dan ack `cs:list` / `cs:history`.
 *
 * Import runtime di file ini dijaga relatif/none karena vitest theater tidak
 * me-resolve alias `@/*` (hanya import type yang aman — dihapus saat transform).
 */

/** Identity stabil satu turn (dedupe hydrate/reply lintas reconnect). */
export function turnKey(t: ChatTurnPayload): string {
  return `${t.conversationId}|${t.role}|${t.timestamp}|${t.message}`;
}

/** Gabung daftar entri inbox (incoming menang per lead id) + urut terbaru. */
export function mergeEntries(existing: InboxEntry[], incoming: InboxEntry[]): InboxEntry[] {
  const byId = new Map<string, InboxEntry>();
  for (const entry of existing) byId.set(entry.lead.id, entry);
  for (const entry of incoming) byId.set(entry.lead.id, entry);
  return [...byId.values()].sort((a, b) =>
    a.lead.updatedAt < b.lead.updatedAt ? 1 : a.lead.updatedAt > b.lead.updatedAt ? -1 : 0,
  );
}

/**
 * Terapkan `lead:update` ke daftar entri: lead baru disisipkan (preview kosong),
 * perubahan status/quote memperbarui entri yang ada tanpa menghapus transkrip.
 */
export function applyLeadUpdate(entries: InboxEntry[], payload: LeadUpdatePayload): InboxEntry[] {
  const current = entries.find((e) => e.lead.id === payload.lead.id);
  const next: InboxEntry = current
    ? { ...current, lead: payload.lead }
    : { lead: payload.lead, lastMessage: null, messageCount: 0 };
  return mergeEntries(
    entries.filter((e) => e.lead.id !== payload.lead.id),
    [next],
  );
}

/** Gabung transkrip (dedupe by turnKey, urut timestamp). */
export function mergeTurns(
  existing: ChatTurnPayload[],
  incoming: ChatTurnPayload[],
): ChatTurnPayload[] {
  const seen = new Set(existing.map(turnKey));
  const merged = [...existing, ...incoming.filter((t) => !seen.has(turnKey(t)))];
  merged.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  return merged;
}

export interface CsQuoteResult {
  leadId: string;
  checkoutUrl: string;
  contractUrl: string;
}

export interface CsSweepSummary {
  checked: number;
  sent: number;
  templates: number;
  lost: number;
}

export interface CsInboxStore {
  entries: InboxEntry[];
  /** Lead yang sedang dibuka di panel transkrip. */
  selectedLeadId: string | null;
  thread: ChatTurnPayload[];
  loading: boolean;
  threadLoading: boolean;
  /** Aksi closing/follow-up sedang berjalan (disable tombol). */
  quoting: boolean;
  sweeping: boolean;
  lastError: string | null;
  /** Hasil sweep terakhir (banner demo). */
  lastSweep: CsSweepSummary | null;
  /** Quote terakhir (tautan checkout + kontrak untuk tombol demo). */
  lastQuote: CsQuoteResult | null;

  /** Ganti seluruh daftar (ack `cs:list`) — merge agar live event tak hilang. */
  setEntries(entries: InboxEntry[]): void;
  setLoading(v: boolean): void;
  /** Terapkan `lead:update` dari Brain. */
  applyUpdate(payload: LeadUpdatePayload): void;
  /** Terapkan `payment:link_created` (mis. quote dari preset/halaman lain). */
  applyPaymentLink(payload: PaymentLinkPayload): void;
  select(leadId: string | null): void;
  /** Ganti transkrip (ack `cs:history`). */
  setThread(turns: ChatTurnPayload[]): void;
  setThreadLoading(v: boolean): void;
  /** Turn baru dari `cs:message` (live) — update transkrip + preview inbox. */
  pushTurn(turn: ChatTurnPayload): void;
  setQuoting(v: boolean): void;
  setSweeping(v: boolean): void;
  setLastError(e: string | null): void;
  setLastSweep(s: CsSweepSummary | null): void;
  setLastQuote(q: CsQuoteResult | null): void;
  reset(): void;
}

export const useCsInbox = create<CsInboxStore>((set) => ({
  entries: [],
  selectedLeadId: null,
  thread: [],
  loading: false,
  threadLoading: false,
  quoting: false,
  sweeping: false,
  lastError: null,
  lastSweep: null,
  lastQuote: null,

  setEntries: (entries) => set((s) => ({ entries: mergeEntries(s.entries, entries) })),
  setLoading: (v) => set({ loading: v }),

  applyUpdate: (payload) => {
    set((s) => ({ entries: applyLeadUpdate(s.entries, payload) }));
  },

  applyPaymentLink: (payload) => {
    set({
      lastQuote: {
        leadId: payload.leadId,
        checkoutUrl: payload.checkoutUrl,
        contractUrl: payload.contractUrl ?? '',
      },
    });
  },

  select: (leadId) => set({ selectedLeadId: leadId, thread: [] }),
  setThread: (turns) => set((s) => ({ thread: mergeTurns(s.thread, turns) })),
  setThreadLoading: (v) => set({ threadLoading: v }),

  pushTurn: (turn) => {
    set((s) => {
      const entries = s.entries.map((e) =>
        e.lead.conversationId === turn.conversationId
          ? { ...e, lastMessage: turn, messageCount: e.messageCount + 1 }
          : e,
      );
      const isSelected = s.entries.some(
        (e) => e.lead.conversationId === turn.conversationId && e.lead.id === s.selectedLeadId,
      );
      return {
        entries,
        ...(isSelected ? { thread: mergeTurns(s.thread, [turn]) } : {}),
      };
    });
  },

  setQuoting: (v) => set({ quoting: v }),
  setSweeping: (v) => set({ sweeping: v }),
  setLastError: (e) => set({ lastError: e }),
  setLastSweep: (s) => set({ lastSweep: s }),
  setLastQuote: (q) => set({ lastQuote: q }),

  reset: () =>
    set({
      entries: [],
      selectedLeadId: null,
      thread: [],
      loading: false,
      threadLoading: false,
      quoting: false,
      sweeping: false,
      lastError: null,
      lastSweep: null,
      lastQuote: null,
    }),
}));
