import { create } from 'zustand';

import type { BriefPayload, ChatTurnPayload } from '@/lib/events';

/**
 * BRIEFING ROOM store (Fase 8 — PRD §3.1/§4.4): thread percakapan Founder↔PM.
 *
 * - Turn durable ada di brain (namespace vector `briefing`); store ini hanya
 *   cache sesi + state UI (typing, compile, error) — reload memulihkan thread
 *   lewat `briefing:history`.
 * - `GO` mengompilasi thread jadi BriefPayload lalu mengirim `directive`-nya
 *   sebagai founder:directive (dilakukan di komponen; store menyimpan hasil).
 */

export interface BriefingStore {
  conversationId: string;
  turns: ChatTurnPayload[];
  /** PM sedang membalas (typing indicator). */
  typing: boolean;
  /** Pesan founder sedang dikirim (menunggu ack). */
  sending: boolean;
  /** Error terakhir (kirim gagal / compile gagal). */
  lastError: string | null;
  /** Brief hasil GO (null sebelum compile). */
  brief: BriefPayload | null;
  /** Compile brief dari brain sedang berjalan. */
  compiling: boolean;
  /** Hasil pengiriman directive hasil compile ('queued' = run berjalan). */
  runStart: { ok: boolean; error?: string } | null;

  setConversationId(id: string): void;
  /** Gabungkan riwayat dari brain (dedupe by identity, urut timestamp). */
  hydrate(turns: ChatTurnPayload[]): void;
  /** Catat pesan founder lokal (optimistic) + nyalakan typing. */
  pushHuman(message: string): ChatTurnPayload;
  /** Terapkan pm:reply dari brain (dedupe bila reconnect mengirim ulang). */
  applyReply(turn: ChatTurnPayload): void;
  setTyping(v: boolean): void;
  setSending(v: boolean): void;
  setLastError(e: string | null): void;
  setBrief(brief: BriefPayload | null): void;
  setCompiling(v: boolean): void;
  setRunStart(r: { ok: boolean; error?: string } | null): void;
  /** Mulai thread baru (conversationId baru); riwayat lama tetap durable di brain. */
  reset(): void;
}

/** Identity stabil satu turn (untuk dedupe hydrate/reply). */
export function turnKey(t: ChatTurnPayload): string {
  return `${t.conversationId}|${t.role}|${t.timestamp}|${t.message}`;
}

let conversationSeq = 0;
/** Id percakapan unik per browser — dipakai lintas reload (localStorage di komponen). */
export function newConversationId(): string {
  conversationSeq += 1;
  return `brief_${Date.now().toString(36)}_${conversationSeq.toString(36)}`;
}

export const useBriefing = create<BriefingStore>((set, get) => ({
  conversationId: '',
  turns: [],
  typing: false,
  sending: false,
  lastError: null,
  brief: null,
  compiling: false,
  runStart: null,

  setConversationId: (id) => set({ conversationId: id }),

  hydrate: (turns) => {
    const s = get();
    const incoming = turns.filter((t) => t.conversationId === s.conversationId);
    const seen = new Set(s.turns.map(turnKey));
    const merged = [...s.turns, ...incoming.filter((t) => !seen.has(turnKey(t)))];
    merged.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
    set({ turns: merged });
  },

  pushHuman: (message) => {
    const turn: ChatTurnPayload = {
      conversationId: get().conversationId,
      channel: 'briefing',
      role: 'human',
      message,
      timestamp: new Date().toISOString(),
    };
    set((s) => ({ turns: [...s.turns, turn], typing: true, lastError: null }));
    return turn;
  },

  applyReply: (turn) => {
    const s = get();
    if (turn.conversationId !== s.conversationId) {
      // Balasan percakapan lain (mis. tab kedua) — tetap berhentikan typing bila cocok.
      return;
    }
    if (s.turns.some((t) => turnKey(t) === turnKey(turn))) {
      set({ typing: false });
      return;
    }
    set({ turns: [...s.turns, turn], typing: false });
  },

  setTyping: (v) => set({ typing: v }),
  setSending: (v) => set({ sending: v }),
  setLastError: (e) => set({ lastError: e }),
  setBrief: (brief) => set({ brief }),
  setCompiling: (v) => set({ compiling: v }),
  setRunStart: (r) => set({ runStart: r }),

  reset: () =>
    set({
      turns: [],
      typing: false,
      sending: false,
      lastError: null,
      brief: null,
      compiling: false,
      runStart: null,
    }),
}));
