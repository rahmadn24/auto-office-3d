'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import {
  compileBrief,
  fetchBriefingHistory,
  sendFounderChat,
  sendFounderDirective,
} from '@/lib/brainSocket';
import type { ChatTurnPayload } from '@/lib/events';
import { GLASS } from '@/lib/ui';
import { clockLabel, useBrain } from '@/store/brainStore';
import { newConversationId, useBriefing } from '@/store/briefingStore';
import { useOffice } from '@/store/officeStore';

/**
 * FLOATING PM CHAT (Fase 8 → dipindah Fase 13-polish): diskusi dulu, otonom
 * kemudian — kini bukan tab terpisah, tapi dock mengambang di bawah Agent
 * Division Sidebar (kiri-bawah, di atas footer).
 *
 * - Thread chat multi-turn Founder↔PM (bubble + avatar PM + typing indicator).
 * - Pesan founder → `founder:chat`; balasan PM datang lewat `pm:reply`.
 * - Tombol GO (disabled saat thread kosong) → `brief:compile` → brief terstruktur
 *   dikirim sebagai `founder:directive` → run otonom penuh berjalan seperti biasa.
 * - Riwayat thread durable di brain: reload/restart dipulihkan via `briefing:history`
 *   dengan conversationId yang disimpan di localStorage.
 * - Bisa diciutkan jadi pill "CHAT PM" (desktop) / FAB (mobile) — kanvas 3D bebas.
 */

const CONVERSATION_KEY = 'ao3d.briefing.conversationId';

const STARTER_PROMPTS = [
  'bangun SaaS invoice generator, target agensi kecil, harga $19/mo',
  'aplikasi kasir + pembukuan untuk UMKM, preset landing',
  'dashboard analytics langganan untuk tim B2B',
] as const;

function chatClock(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '' : clockLabel(at);
}

function PmAvatar(): ReactNode {
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#38bdf8]/40 bg-[#38bdf8]/10 font-mono text-[9px] font-bold text-[#38bdf8]"
    >
      PM
    </span>
  );
}

function Bubble({ turn }: { turn: ChatTurnPayload }): ReactNode {
  const mine = turn.role === 'human';
  return (
    <div className={`flex items-end gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine ? <PmAvatar /> : null}
      <div className={`max-w-[88%] ${mine ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl border px-2.5 py-1.5 ${
            mine
              ? 'rounded-br-sm border-[#6366f1]/35 bg-[#6366f1]/15'
              : 'rounded-bl-sm border-white/8 bg-surface-container-low/80'
          }`}
        >
          <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-primary">
            {turn.message}
          </p>
          {!mine && turn.citations && turn.citations.length > 0 ? (
            <ul className="mt-1.5 flex flex-col gap-0.5 border-t border-white/6 pt-1">
              {turn.citations.slice(0, 2).map((c) => (
                <li key={c} title={c} className="truncate font-mono text-[9.5px] text-tertiary">
                  ↳ {c}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className={`mt-0.5 font-mono text-[9.5px] text-tertiary ${mine ? 'text-right' : ''}`}>
          {chatClock(turn.timestamp)}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator(): ReactNode {
  return (
    <div className="flex items-end gap-1.5" aria-live="polite">
      <PmAvatar />
      <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-white/8 bg-surface-container-low/80 px-2.5 py-2">
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#38bdf8]"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </span>
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-tertiary">
          PM menulis…
        </span>
      </div>
    </div>
  );
}

export function PmChatDock(): ReactNode {
  const connection = useBrain((s) => s.connection);
  const pushDirective = useBrain((s) => s.pushDirective);
  const setCameraPreset = useOffice((s) => s.setCameraPreset);

  const conversationId = useBriefing((s) => s.conversationId);
  const turns = useBriefing((s) => s.turns);
  const typing = useBriefing((s) => s.typing);
  const sending = useBriefing((s) => s.sending);
  const lastError = useBriefing((s) => s.lastError);
  const brief = useBriefing((s) => s.brief);
  const compiling = useBriefing((s) => s.compiling);
  const runStart = useBriefing((s) => s.runStart);

  const [open, setOpen] = useState(true);
  const [value, setValue] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const connected = connection === 'connected';
  const humanTurns = turns.filter((t) => t.role === 'human').length;

  // Conversation id persist di localStorage → reload melanjutkan thread yang sama.
  useEffect(() => {
    const stored = window.localStorage.getItem(CONVERSATION_KEY);
    const id = stored && stored.trim().length > 0 ? stored : newConversationId();
    window.localStorage.setItem(CONVERSATION_KEY, id);
    useBriefing.getState().setConversationId(id);
  }, []);

  // Pulihkan riwayat durable tiap (re)connect / ganti percakapan.
  useEffect(() => {
    if (connection !== 'connected' || !conversationId) return;
    let cancelled = false;
    void fetchBriefingHistory(conversationId).then((history) => {
      if (!cancelled) useBriefing.getState().hydrate(history);
    });
    return () => {
      cancelled = true;
    };
  }, [connection, conversationId]);

  // Auto-scroll ke turn terbaru (hanya saat panel terbuka & sudah ada isi).
  // Thread kosong jangan di-scroll: intro/saran PM di atas ikut terpotong.
  useEffect(() => {
    const el = threadRef.current;
    if (open && el && (turns.length > 0 || typing)) el.scrollTop = el.scrollHeight;
  }, [turns.length, typing, open]);

  // Escape menciutkan panel (fokus balik ke tombol pemicu di handle).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && panelRef.current?.contains(document.activeElement)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const text = value.trim();
    if (!text || !connected || sending || typing) return;
    setValue('');
    const store = useBriefing.getState();
    store.pushHuman(text);
    store.setSending(true);
    const res = await sendFounderChat(conversationId, text);
    store.setSending(false);
    if (!res.ok) {
      store.setTyping(false);
      store.setLastError(res.error ?? 'gagal mengirim pesan');
    }
  }

  async function handleGo(): Promise<void> {
    if (humanTurns === 0 || !connected || compiling || typing) return;
    const store = useBriefing.getState();
    store.setCompiling(true);
    store.setLastError(null);
    store.setRunStart(null);

    const compiled = await compileBrief(conversationId);
    if (!compiled.ok) {
      store.setCompiling(false);
      store.setLastError(compiled.error);
      return;
    }
    store.setBrief(compiled.brief);
    // PRD §4.3 — kamera ke Meja Founder saat directive founder dikirim.
    setCameraPreset('founder');
    const sent = await sendFounderDirective(compiled.brief.directive);
    pushDirective(compiled.brief.directive, sent.ok ? 'queued' : 'failed', sent.error);
    store.setRunStart(sent.ok ? { ok: true } : { ok: false, error: sent.error });
    store.setCompiling(false);
  }

  function startNewThread(): void {
    const id = newConversationId();
    window.localStorage.setItem(CONVERSATION_KEY, id);
    useBriefing.getState().reset();
    useBriefing.getState().setConversationId(id);
  }

  // Pill saat tertutup — menempel di bawah sidebar (kolom kiri), full-width.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        aria-controls="pm-chat-panel"
        className={`pointer-events-auto flex w-full items-center gap-2 rounded-full px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-[#38bdf8] ${GLASS}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[#38bdf8]" />
        chat pm
        {humanTurns > 0 ? <span className="text-tertiary">· {humanTurns}</span> : null}
      </button>
    );
  }

  return (
    <section
      id="pm-chat-panel"
      ref={panelRef}
      role="region"
      aria-label="Chat PM (Briefing)"
      className={`pointer-events-auto flex max-h-[46vh] min-h-0 w-full flex-col overflow-hidden rounded-xl md:max-h-none md:min-h-[12rem] md:flex-1 ${GLASS}`}
    >
      {/* Header panel */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/6 px-2.5 py-1.5">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#38bdf8]" />
          <h2 className="font-mono text-[10px] uppercase tracking-wide text-[#94a3b8]">
            Chat PM <span className="text-tertiary">· briefing</span>
          </h2>
        </span>
        <span className="flex items-center gap-1">
          <span className="hidden font-mono text-[9px] uppercase tracking-wide text-tertiary sm:inline">
            {humanTurns > 0 ? `${humanTurns} prompt` : 'thread kosong'}
          </span>
          <button
            type="button"
            onClick={startNewThread}
            title="Mulai thread baru (riwayat lama tetap tersimpan di brain)"
            aria-label="Mulai thread baru"
            className="rounded border border-grid-major/60 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-tertiary transition-colors hover:text-secondary"
          >
            ＋
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            title="Ciutkan chat PM"
            aria-label="Ciutkan chat PM"
            aria-expanded
            aria-controls="pm-chat-panel"
            className="rounded border border-grid-major/60 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-tertiary transition-colors hover:text-secondary"
          >
            ▾
          </button>
        </span>
      </header>

      {/* Thread */}
      <div ref={threadRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2.5 py-2.5">
        {turns.length === 0 && !typing ? (
          <div className="flex flex-col items-center gap-2 py-3 text-center">
            <PmAvatar />
            <p className="text-[11.5px] leading-relaxed text-secondary">
              Ceritakan produk yang mau dibangun — saya (<span className="text-[#38bdf8]">PM</span>)
              tanya requirement &amp; recall memori run sebelumnya. Kalau brief matang tekan{' '}
              <span className="text-[#4edea3]">GO</span>.
            </p>
            <div className="flex flex-wrap justify-center gap-1">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setValue(p)}
                  className="rounded-full border border-white/10 bg-white/4 px-2 py-0.5 text-left font-mono text-[9.5px] text-secondary transition-colors hover:border-[#38bdf8]/40 hover:text-[#38bdf8]"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((t) => (
          <Bubble key={`${t.role}-${t.timestamp}-${t.message.slice(0, 24)}`} turn={t} />
        ))}
        {typing ? <TypingIndicator /> : null}

        {/* Brief hasil compile + status run */}
        {brief ? (
          <div className="rounded-lg border border-[#4edea3]/25 bg-[#4edea3]/6 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#4edea3]">
                Brief terkompilasi · {brief.projectName}
              </span>
              <span className="font-mono text-[9.5px] text-tertiary">{brief.pricing}</span>
            </div>
            <dl className="mt-1.5 grid grid-cols-1 gap-1 text-[11px] leading-snug text-secondary">
              <div>
                <dt className="font-mono text-[9.5px] uppercase text-tertiary">Audience</dt>
                <dd>{brief.audience}</dd>
              </div>
              <div>
                <dt className="font-mono text-[9.5px] uppercase text-tertiary">Preset stack</dt>
                <dd>{brief.preset}</dd>
              </div>
              <div>
                <dt className="font-mono text-[9.5px] uppercase text-tertiary">Fitur wajib</dt>
                <dd>{brief.features.join(' · ')}</dd>
              </div>
            </dl>
            {runStart?.ok ? (
              <div className="mt-1.5 border-t border-white/8 pt-1.5 font-mono text-[9.5px] uppercase tracking-wide text-[#4edea3]">
                ✓ directive terkirim · menunggu status agent
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Error bar */}
      {lastError ? (
        <div className="mx-2.5 mb-1 flex items-center justify-between rounded-md border border-[#ef4444]/40 bg-[#ef4444]/10 px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-[#ef4444]">
          <span>briefing gagal: {lastError}</span>
          <button
            type="button"
            onClick={() => useBriefing.getState().setLastError(null)}
            aria-label="Tutup error"
            className="rounded px-1 transition-colors hover:bg-white/10"
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* Composer + GO — input satu baris penuh, aksi di baris kedua. */}
      <div className="shrink-0 border-t border-white/6 p-2.5">
        <form onSubmit={submit} className="flex flex-col gap-1.5">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!connected}
            maxLength={500}
            placeholder={connected ? 'tulis pesan untuk PM…' : 'menunggu brain…'}
            aria-label="Tulis pesan untuk PM"
            className="w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 font-mono text-[12px] text-primary placeholder:text-tertiary focus:border-[#38bdf8]/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="submit"
              disabled={!connected || sending || typing || value.trim().length === 0}
              className="shrink-0 rounded-md bg-[#6366f1]/20 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide text-[#818cf8] transition-colors hover:bg-[#6366f1]/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? '…' : 'kirim ▸'}
            </button>
            <button
              type="button"
              onClick={() => void handleGo()}
              disabled={!connected || humanTurns === 0 || compiling || typing}
              title={
                humanTurns === 0
                  ? 'Kirim minimal satu pesan dulu — GO mengompilasi brief dari diskusi'
                  : 'Compile brief dari diskusi → founder:directive → run otonom'
              }
              className="min-w-0 flex-1 rounded-md border border-[#4edea3]/45 bg-[#4edea3]/12 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide text-[#4edea3] transition-colors hover:bg-[#4edea3]/22 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {compiling ? '…' : 'GO — mulai run otonom'}
            </button>
          </div>
          <div className="font-mono text-[9px] uppercase tracking-wide text-tertiary">
            founder:chat ⇄ pm:reply · durable di brain
          </div>
        </form>
      </div>
    </section>
  );
}
