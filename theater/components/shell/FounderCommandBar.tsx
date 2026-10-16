'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { sendFounderDirective } from '@/lib/brainSocket';
import { GLASS } from '@/lib/ui';
import { useBrain } from '@/store/brainStore';
import { useOffice } from '@/store/officeStore';

/**
 * FOUNDER COMMAND BAR (PRD §3.1) — satu-satunya input manusia ke Brain.
 * Menempel di AppShell (terlihat di semua tab). Submit → emit `founder:directive`
 * via Socket.io → Brain menjalankan run autonomous penuh; balasan agen mengalir
 * balik lewat `agent:status_update` (Agent Stream + tokoh 3D). Riwayat prompt
 * tersimpan di store (maks 8) dan bisa dipanggil ulang lewat panel riwayat.
 *
 * Saat directive terkirim, kamera 3D preset `Founder` aktif (PRD §4.3:
 * "kamera fokus ke Meja Founder saat pengetikan prompt awal").
 */
export function FounderCommandBar(): ReactNode {
  const connection = useBrain((s) => s.connection);
  const directives = useBrain((s) => s.directives);
  const pushDirective = useBrain((s) => s.pushDirective);
  const setCameraPreset = useOffice((s) => s.setCameraPreset);

  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  const connected = connection === 'connected';
  const last = directives[0];

  // Tutup panel riwayat saat klik di luarnya.
  useEffect(() => {
    if (!showHistory) return;
    const onDown = (e: MouseEvent): void => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showHistory]);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const prompt = value.trim();
    if (!prompt || sending) return;
    setSending(true);
    setLastError(null);
    // PRD §4.3 — kamera cinematis ke Meja Founder saat prompt dikirim.
    setCameraPreset('founder');
    const res = await sendFounderDirective(prompt);
    pushDirective(prompt, res.ok ? 'queued' : 'failed', res.error);
    if (!res.ok) setLastError(res.error ?? 'gagal mengirim');
    else setValue('');
    setSending(false);
    inputRef.current?.focus();
  }

  return (
    <div className="relative z-30 shrink-0 px-3 pb-14 pt-2 md:px-4 md:pb-2">
      <form
        onSubmit={submit}
        className={`flex items-center gap-2 rounded-xl px-3 py-2 ${GLASS}`}
        aria-label="Founder command bar"
      >
        {/* Label — menyerupai prompt terminal */}
        <span className="hidden shrink-0 items-center gap-1.5 font-mono text-mono-label uppercase tracking-wide sm:flex">
          <span className="text-[#6366f1]">▸</span>
          <span className="text-secondary">Founder</span>
          <span className="text-tertiary">prompt</span>
        </span>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!connected || sending}
          maxLength={500}
          placeholder={
            connected
              ? 'perintah satu baris untuk agen — mis. "bangun landing page SaaS invoice…"'
              : 'menunggu sambungan brain…'
          }
          aria-label="Tulis directive founder"
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-primary placeholder:text-tertiary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />

        {/* Riwayat prompt sebelumnya */}
        <div ref={historyRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            disabled={directives.length === 0}
            aria-label="Riwayat directive"
            title="Riwayat directive"
            className="rounded border border-grid-major/60 px-2 py-1 font-mono text-mono-label uppercase tracking-wide text-tertiary transition-colors hover:text-secondary disabled:opacity-40"
          >
            ↺ {directives.length}
          </button>
          {showHistory && directives.length > 0 ? (
            <div
              className={`absolute bottom-full right-0 mb-2 max-h-64 w-80 overflow-y-auto rounded-xl p-2 ${GLASS}`}
            >
              <div className="px-1 pb-1.5 font-mono text-mono-label uppercase tracking-wide text-tertiary">
                Riwayat directive
              </div>
              <ul className="flex flex-col gap-1">
                {directives.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setValue(d.prompt);
                        setShowHistory(false);
                        inputRef.current?.focus();
                      }}
                      className="w-full rounded-lg border border-grid-major/40 bg-surface-container-low/70 px-2 py-1.5 text-left transition-colors hover:bg-white/5"
                    >
                      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wide">
                        <span
                          className="rounded px-1"
                          style={{
                            backgroundColor:
                              d.status === 'queued'
                                ? 'rgba(78,222,163,0.15)'
                                : 'rgba(239,68,68,0.15)',
                            color: d.status === 'queued' ? '#4edea3' : '#ef4444',
                          }}
                        >
                          {d.status}
                        </span>
                        <span className="text-tertiary">{d.tsLabel}</span>
                      </div>
                      <div className="mt-1 break-words font-mono text-[11px] text-secondary">
                        {d.prompt}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!connected || sending || value.trim().length === 0}
          className="shrink-0 rounded-md bg-[#6366f1]/20 px-3 py-1 font-mono text-mono-label uppercase tracking-wide text-[#818cf8] transition-colors hover:bg-[#6366f1]/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? 'queued…' : 'run ▸'}
        </button>
      </form>

      {/* Status ack terakhir — queued sukses tidak perlu notifikasi (stream
          agen langsung hidup); hanya kegagalan yang ditampilkan. */}
      {lastError ? (
        <div className="mt-1 flex items-center justify-between rounded-md border border-[#ef4444]/40 bg-[#ef4444]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[#ef4444]">
          <span>directive gagal: {lastError}</span>
          <button
            type="button"
            onClick={() => setLastError(null)}
            aria-label="Tutup error"
            className="rounded px-1 transition-colors hover:bg-white/10"
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* Pill ringkas directive terakhir (desktop) — pengingat singkat tanpa
          membuka panel riwayat. */}
      {last && last.status === 'queued' && lastError === null ? (
        <div className="pointer-events-none mt-1 hidden justify-end md:flex">
          <span className="max-w-[60%] truncate rounded-full border border-[#4edea3]/30 bg-[#4edea3]/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#4edea3]">
            queued · {last.prompt}
          </span>
        </div>
      ) : null}
    </div>
  );
}
