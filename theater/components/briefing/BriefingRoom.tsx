'use client';

import Link from 'next/link';
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
 * BRIEFING ROOM (Fase 8 — PRD §1.2 & §4.4): diskusi dulu, otonom kemudian.
 *
 * - Thread chat multi-turn Founder↔PM (bubble + avatar PM + typing indicator).
 * - Pesan founder → `founder:chat`; balasan PM datang lewat `pm:reply`.
 * - Tombol GO (disabled saat thread kosong) → `brief:compile` → brief terstruktur
 *   dikirim sebagai `founder:directive` → run otonom penuh berjalan seperti biasa.
 * - Riwayat thread durable di brain: reload/restart dipulihkan via `briefing:history`
 *   dengan conversationId yang disimpan di localStorage.
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
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#38bdf8]/40 bg-[#38bdf8]/10 font-mono text-[10px] font-bold text-[#38bdf8]"
    >
      PM
    </span>
  );
}

function Bubble({ turn }: { turn: ChatTurnPayload }): ReactNode {
  const mine = turn.role === 'human';
  return (
    <div className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine ? <PmAvatar /> : null}
      <div className={`max-w-[85%] md:max-w-[70%] ${mine ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl border px-3 py-2 ${
            mine
              ? 'rounded-br-sm border-[#6366f1]/35 bg-[#6366f1]/15'
              : 'rounded-bl-sm border-white/8 bg-surface-container-low/80'
          }`}
        >
          {!mine ? (
            <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide">
              <span className="text-[#38bdf8]">PM Agent</span>
              <span className="text-tertiary">Product</span>
            </div>
          ) : null}
          <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-primary">
            {turn.message}
          </p>
          {!mine && turn.citations && turn.citations.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-0.5 border-t border-white/6 pt-1.5">
              {turn.citations.slice(0, 2).map((c) => (
                <li key={c} title={c} className="truncate font-mono text-[10px] text-tertiary">
                  ↳ {c}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className={`mt-0.5 font-mono text-[10px] text-tertiary ${mine ? 'text-right' : ''}`}>
          {chatClock(turn.timestamp)}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator(): ReactNode {
  return (
    <div className="flex items-end gap-2" aria-live="polite">
      <PmAvatar />
      <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-white/8 bg-surface-container-low/80 px-3 py-2.5">
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#38bdf8]"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wide text-tertiary">
          PM sedang menulis…
        </span>
      </div>
    </div>
  );
}

export function BriefingRoom(): ReactNode {
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

  const [value, setValue] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll ke turn terbaru.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, typing]);

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

  return (
    <div className="h-full w-full overflow-hidden p-3 pb-2 md:p-4 xl:p-6">
      <div className={`flex h-full min-h-0 flex-col rounded-xl ${GLASS}`}>
        {/* Header panel */}
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/6 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#38bdf8]" />
            <h2 className="font-mono text-mono-label uppercase tracking-wide text-[#94a3b8]">
              Briefing Room <span className="text-tertiary">· diskusi dulu, otonom kemudian</span>
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[10px] uppercase tracking-wide text-tertiary sm:inline">
              {humanTurns > 0 ? `${humanTurns} prompt` : 'thread kosong'}
            </span>
            <button
              type="button"
              onClick={startNewThread}
              title="Mulai thread baru (riwayat lama tetap tersimpan di brain)"
              className="rounded border border-grid-major/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-tertiary transition-colors hover:text-secondary"
            >
              ＋ thread baru
            </button>
          </div>
        </header>

        {/* Thread */}
        <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {turns.length === 0 && !typing ? (
            <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-6 text-center">
              <PmAvatar />
              <p className="text-[12.5px] leading-relaxed text-secondary">
                Selamat datang di <span className="text-[#38bdf8]">Briefing Room</span>. Ceritakan
                produk yang mau dibangun — saya (PM Agent) akan menanyakan requirement, menawarkan
                alternatif arsitektur/bisnis, dan merecall memori run sebelumnya. Kalau brief sudah
                matang, tekan <span className="text-[#4edea3]">GO</span> dan tim otonom mulai
                bekerja.
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {STARTER_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setValue(p)}
                    className="rounded-full border border-white/10 bg-white/4 px-2.5 py-1 font-mono text-[10px] text-secondary transition-colors hover:border-[#38bdf8]/40 hover:text-[#38bdf8]"
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
            <div className="mx-auto max-w-2xl rounded-xl border border-[#4edea3]/25 bg-[#4edea3]/6 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wide text-[#4edea3]">
                  Brief terkompilasi · {brief.projectName}
                </span>
                <span className="font-mono text-[10px] text-tertiary">{brief.pricing}</span>
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-1.5 text-[11.5px] leading-snug text-secondary sm:grid-cols-2">
                <div>
                  <dt className="font-mono text-[10px] uppercase text-tertiary">Audience</dt>
                  <dd>{brief.audience}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase text-tertiary">Preset stack</dt>
                  <dd>{brief.preset}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-mono text-[10px] uppercase text-tertiary">Fitur wajib</dt>
                  <dd>{brief.features.join(' · ')}</dd>
                </div>
              </dl>
              {runStart?.ok ? (
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/8 pt-2">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[#4edea3]">
                    ✓ run otonom berjalan · founder:directive terkirim
                  </span>
                  <Link
                    href="/"
                    className="rounded border border-[#38bdf8]/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#38bdf8] transition-colors hover:bg-[#38bdf8]/10"
                  >
                    Office Theater ▸
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Error bar */}
        {lastError ? (
          <div className="mx-3 mb-1 flex items-center justify-between rounded-md border border-[#ef4444]/40 bg-[#ef4444]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[#ef4444]">
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

        {/* Composer + GO */}
        <div className="shrink-0 border-t border-white/6 p-3">
          <form onSubmit={submit} className="flex items-center gap-2">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={!connected}
              maxLength={500}
              placeholder={
                connected
                  ? 'tulis pesan untuk PM — mis. "targetnya freelancer, fitur invoice + checkout"'
                  : 'menunggu sambungan brain…'
              }
              aria-label="Tulis pesan untuk PM"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-[12px] text-primary placeholder:text-tertiary focus:border-[#38bdf8]/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!connected || sending || typing || value.trim().length === 0}
              className="shrink-0 rounded-md bg-[#6366f1]/20 px-3 py-2 font-mono text-mono-label uppercase tracking-wide text-[#818cf8] transition-colors hover:bg-[#6366f1]/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? 'kirim…' : 'kirim ▸'}
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
              className="shrink-0 rounded-md border border-[#4edea3]/45 bg-[#4edea3]/12 px-3 py-2 font-mono text-mono-label uppercase tracking-wide text-[#4edea3] transition-colors hover:bg-[#4edea3]/22 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {compiling ? 'compile…' : 'GO — mulai run otonom'}
            </button>
          </form>
          <div className="mt-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wide text-tertiary">
            <span>founder:chat ⇄ pm:reply · namespace briefing (durable)</span>
            <span className="hidden sm:inline">
              command bar di bawah tetap fast-path tanpa diskusi
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
