'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import {
  brainHttpUrl,
  fetchCsHistory,
  fetchCsInbox,
  requestCsQuote,
  runCsSweep,
} from '@/lib/brainSocket';
import type { ChatTurnPayload, Lead, LeadSource, LeadStatus } from '@/lib/events';
import { GLASS } from '@/lib/ui';
import { clockLabel, useBrain } from '@/store/brainStore';
import { useCsInbox } from '@/store/csStore';

/**
 * CS INBOX (Fase 11 — PRD §3.5): omnichannel inbox untuk lead yang masuk dari
 * widget, WhatsApp Cloud API, dan email inbound. Lead store durable di Brain
 * (SQLite) — tab ini membaca `cs:list`/`cs:history` dan mendengarkan
 * `lead:update` + `cs:message` lewat BrainBridge (app/layout.tsx).
 *
 * Aksi:
 *   • QUOTE   → payment link (driver aktif) + kontrak PDF otomatis + kirim ke client;
 *   • SWEEP   → jalankan follow-up engine sekarang (scheduler tetap jalan);
 *   • buka kontrak/checkout untuk demo closing → bayar → status deal.
 */

const STATUS_STYLE: Record<LeadStatus, { label: string; className: string }> = {
  new: { label: 'baru', className: 'border-white/15 bg-white/6 text-[#cbd5e1]' },
  contacted: {
    label: 'dihubungi',
    className: 'border-[#38bdf8]/40 bg-[#38bdf8]/10 text-[#38bdf8]',
  },
  qualified: {
    label: 'quote terkirim',
    className: 'border-[#ffb95f]/40 bg-[#ffb95f]/10 text-[#ffb95f]',
  },
  deal: { label: 'deal ✓', className: 'border-[#4edea3]/45 bg-[#4edea3]/12 text-[#4edea3]' },
  lost: { label: 'lost', className: 'border-[#ef4444]/40 bg-[#ef4444]/10 text-[#ef4444]' },
};

const SOURCE_LABEL: Record<LeadSource, string> = {
  widget: '💬 widget',
  whatsapp: '🟢 whatsapp',
  email: '✉️ email',
};

function chatClock(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '' : clockLabel(at);
}

function csClock(iso: string | null): string {
  if (!iso) return '—';
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '—' : clockLabel(at);
}

function LeadRow({
  lead,
  preview,
  count,
  active,
  onSelect,
}: {
  lead: Lead;
  preview: ChatTurnPayload | null;
  count: number;
  active: boolean;
  onSelect(): void;
}): ReactNode {
  const status = STATUS_STYLE[lead.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className="w-full rounded-lg border px-2.5 py-2 text-left transition-colors"
      style={{
        borderColor: active ? 'rgba(56,189,248,0.5)' : 'rgba(148,163,184,0.14)',
        backgroundColor: active ? 'rgba(56,189,248,0.08)' : 'rgba(255,255,255,0.02)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12.5px] font-semibold text-primary">
          {lead.name || lead.contact}
        </span>
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${status.className}`}
        >
          {status.label}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wide text-tertiary">
        <span className="truncate">
          {SOURCE_LABEL[lead.source]} · {count} pesan
        </span>
        <span className="shrink-0 normal-case">{csClock(lead.updatedAt)}</span>
      </div>
      <p className="mt-1 truncate text-[11px] leading-snug text-secondary">
        {preview
          ? `${preview.role === 'agent' ? 'CS: ' : ''}${preview.message}`
          : lead.interest || '—'}
      </p>
    </button>
  );
}

function TurnBubble({ turn }: { turn: ChatTurnPayload }): ReactNode {
  const mine = turn.role === 'human';
  return (
    <div className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine ? (
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#4edea3]/40 bg-[#4edea3]/10 font-mono text-[10px] font-bold text-[#4edea3]"
        >
          CS
        </span>
      ) : (
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#6366f1]/40 bg-[#6366f1]/12 font-mono text-[10px] font-bold text-[#818cf8]"
        >
          CL
        </span>
      )}
      <div className={`max-w-[85%] ${mine ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl border px-3 py-2 ${
            mine
              ? 'rounded-br-sm border-[#6366f1]/35 bg-[#6366f1]/15'
              : 'rounded-bl-sm border-white/8 bg-surface-container-low/80'
          }`}
        >
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

export function CsInbox(): ReactNode {
  const connection = useBrain((s) => s.connection);
  const entries = useCsInbox((s) => s.entries);
  const selectedLeadId = useCsInbox((s) => s.selectedLeadId);
  const thread = useCsInbox((s) => s.thread);
  const loading = useCsInbox((s) => s.loading);
  const threadLoading = useCsInbox((s) => s.threadLoading);
  const quoting = useCsInbox((s) => s.quoting);
  const sweeping = useCsInbox((s) => s.sweeping);
  const lastError = useCsInbox((s) => s.lastError);
  const lastSweep = useCsInbox((s) => s.lastSweep);
  const lastQuote = useCsInbox((s) => s.lastQuote);

  const threadRef = useRef<HTMLDivElement>(null);
  const connected = connection === 'connected';
  const selected = entries.find((e) => e.lead.id === selectedLeadId) ?? null;
  // Tautan closing: hasil quote sesi ini, atau quote durable dari lead (reload).
  const closing =
    selected && lastQuote && lastQuote.leadId === selected.lead.id
      ? lastQuote
      : selected?.lead.quote
        ? {
            leadId: selected.lead.id,
            checkoutUrl: selected.lead.quote.checkoutUrl,
            contractUrl: selected.lead.quote.contractUrl,
          }
        : null;

  // Muat inbox tiap (re)connect; live selanjutnya lewat lead:update/cs:message.
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    useCsInbox.getState().setLoading(true);
    void fetchCsInbox(50).then((list) => {
      if (cancelled) return;
      useCsInbox.getState().setEntries(list);
      useCsInbox.getState().setLoading(false);
      const current = useCsInbox.getState().selectedLeadId;
      if (!current && list.length > 0) useCsInbox.getState().select(list[0]?.lead.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [connected]);

  // Transkrip lead terpilih (durable) tiap ganti selection / reconnect.
  useEffect(() => {
    if (!connected || !selectedLeadId) return;
    const entry = useCsInbox.getState().entries.find((e) => e.lead.id === selectedLeadId);
    if (!entry) return;
    let cancelled = false;
    useCsInbox.getState().setThreadLoading(true);
    void fetchCsHistory(entry.lead.conversationId).then((history) => {
      if (cancelled) return;
      useCsInbox.getState().setThread(history);
      useCsInbox.getState().setThreadLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [connected, selectedLeadId, entries.length]);

  // Auto-scroll transkrip.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length]);

  async function handleQuote(): Promise<void> {
    if (!selected || quoting) return;
    const store = useCsInbox.getState();
    store.setQuoting(true);
    store.setLastError(null);
    const res = await requestCsQuote({ leadId: selected.lead.id });
    store.setQuoting(false);
    if (!res.ok) store.setLastError(res.error);
  }

  async function handleSweep(): Promise<void> {
    if (sweeping) return;
    const store = useCsInbox.getState();
    store.setSweeping(true);
    store.setLastError(null);
    const res = await runCsSweep(true);
    store.setSweeping(false);
    if (!res.ok) store.setLastError(res.error);
  }

  const dealCount = entries.filter((e) => e.lead.status === 'deal').length;
  const openCount = entries.filter((e) =>
    ['new', 'contacted', 'qualified'].includes(e.lead.status),
  ).length;

  return (
    <div className="h-full w-full overflow-hidden p-3 pb-2 md:p-4 xl:p-6">
      <div className={`flex h-full min-h-0 flex-col rounded-xl ${GLASS}`}>
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/6 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#4edea3]" />
            <h2 className="font-mono text-mono-label uppercase tracking-wide text-[#94a3b8]">
              CS Inbox <span className="text-tertiary">· omnichannel leads & closing</span>
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[10px] uppercase tracking-wide text-tertiary sm:inline">
              {entries.length} lead · {openCount} terbuka · {dealCount} deal
            </span>
            <button
              type="button"
              onClick={() => void handleSweep()}
              disabled={!connected || sweeping}
              title="Jalankan follow-up engine sekarang (scheduler brain tetap jalan tiap interval)"
              className="rounded border border-[#ffb95f]/45 bg-[#ffb95f]/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#ffb95f] transition-colors hover:bg-[#ffb95f]/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sweeping ? 'sweep…' : '↻ sweep follow-up'}
            </button>
          </div>
        </header>

        {/* Banner sweep terakhir */}
        {lastSweep ? (
          <div className="mx-3 mt-2 flex items-center justify-between rounded-md border border-[#ffb95f]/25 bg-[#ffb95f]/6 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[#ffb95f]">
            <span>
              sweep · {lastSweep.checked} dicek · {lastSweep.sent} terkirim · {lastSweep.templates}{' '}
              template HSM · {lastSweep.lost} lost
            </span>
            <button
              type="button"
              onClick={() => useCsInbox.getState().setLastSweep(null)}
              aria-label="Tutup banner sweep"
              className="rounded px-1 transition-colors hover:bg-white/10"
            >
              ✕
            </button>
          </div>
        ) : null}

        {/* Body: daftar lead + transkrip */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <section className="flex min-h-0 shrink-0 flex-col border-b border-white/6 md:w-[300px] md:border-b-0 md:border-r">
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
              {loading && entries.length === 0 ? (
                <p className="px-1 py-4 text-center font-mono text-[10px] uppercase tracking-wide text-tertiary">
                  memuat inbox…
                </p>
              ) : null}
              {!loading && entries.length === 0 ? (
                <div className="px-2 py-4 text-center">
                  <p className="text-[12px] leading-relaxed text-secondary">
                    Belum ada lead. Coba buka{' '}
                    <a
                      href={brainHttpUrl('/demo/widget')}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#38bdf8] underline"
                    >
                      halaman demo widget
                    </a>{' '}
                    (atau kirim ke webhook WhatsApp/email) — pesan pertama langsung muncul di sini.
                  </p>
                </div>
              ) : null}
              {entries.map((e) => (
                <LeadRow
                  key={e.lead.id}
                  lead={e.lead}
                  preview={e.lastMessage}
                  count={e.messageCount}
                  active={e.lead.id === selectedLeadId}
                  onSelect={() => useCsInbox.getState().select(e.lead.id)}
                />
              ))}
            </div>
          </section>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {selected ? (
              <>
                {/* Detail lead + aksi closing */}
                <div className="shrink-0 border-b border-white/6 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-primary">
                        {selected.lead.name || selected.lead.contact}{' '}
                        <span className="font-mono text-[10px] font-normal uppercase text-tertiary">
                          {SOURCE_LABEL[selected.lead.source]} · {selected.lead.conversationId}
                        </span>
                      </p>
                      <p className="truncate font-mono text-[10px] uppercase tracking-wide text-tertiary">
                        follow-up {selected.lead.followupsSent}× · jadwal berikutnya{' '}
                        {csClock(selected.lead.nextFollowupAt)}
                        {selected.lead.quote ? ` · quote ${selected.lead.quote.productName}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {closing ? (
                        <>
                          <a
                            href={closing.checkoutUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border border-[#38bdf8]/45 bg-[#38bdf8]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[#38bdf8] transition-colors hover:bg-[#38bdf8]/20"
                          >
                            checkout ▸
                          </a>
                          <a
                            href={closing.contractUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border border-white/15 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-secondary transition-colors hover:text-primary"
                          >
                            kontrak PDF ▸
                          </a>
                        </>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleQuote()}
                        disabled={!connected || quoting || selected.lead.status === 'deal'}
                        title="Payment link + kontrak PDF dikirim otomatis ke channel lead"
                        className="rounded border border-[#4edea3]/45 bg-[#4edea3]/12 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[#4edea3] transition-colors hover:bg-[#4edea3]/22 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {quoting ? 'quote…' : '＄ kirim quote'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Transkrip */}
                <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
                  {threadLoading && thread.length === 0 ? (
                    <p className="py-4 text-center font-mono text-[10px] uppercase tracking-wide text-tertiary">
                      memuat transkrip…
                    </p>
                  ) : null}
                  {thread.length === 0 && !threadLoading ? (
                    <p className="py-4 text-center text-[12px] text-tertiary">
                      Belum ada transkrip untuk percakapan ini.
                    </p>
                  ) : null}
                  {thread.map((t) => (
                    <TurnBubble
                      key={`${t.role}-${t.timestamp}-${t.message.slice(0, 24)}`}
                      turn={t}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                <p className="max-w-md text-center text-[12.5px] leading-relaxed text-secondary">
                  Pilih lead di kiri untuk melihat transkrip, mengirim quote/payment link, dan
                  memantau closing. Lead datang otomatis dari widget halaman produk, WhatsApp Cloud
                  API, dan email inbound — handoff Marketer juga menulis ke store yang sama.
                </p>
              </div>
            )}
          </section>
        </div>

        {/* Error bar */}
        {lastError ? (
          <div className="mx-3 mb-1 flex items-center justify-between rounded-md border border-[#ef4444]/40 bg-[#ef4444]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[#ef4444]">
            <span>cs inbox gagal: {lastError}</span>
            <button
              type="button"
              onClick={() => useCsInbox.getState().setLastError(null)}
              aria-label="Tutup error"
              className="rounded px-1 transition-colors hover:bg-white/10"
            >
              ✕
            </button>
          </div>
        ) : null}

        {/* Footer */}
        <div className="shrink-0 border-t border-white/6 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-tertiary">
          lead:update ⇄ cs:message · leads store durable (SQLite) · guard 24 jam WhatsApp → template
          HSM
        </div>
      </div>
    </div>
  );
}
