'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { formatMoney } from '@/lib/format';
import { useBrain } from '@/store/brainStore';
import { useOffice } from '@/store/officeStore';

/** Chime fanfare Web Audio: akor naik C–E–G–C (triangle, envelope 0.5s). */
function playFanfare(ctx: AudioContext): void {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const start = ctx.currentTime;
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = start + i * 0.14;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.6);
  });
}

/**
 * Overlay perayaan (PRD §1.2 milestone #5, §3.4):
 * banner "FIRST CUSTOMER ACQUIRED", fanfare chime, dan tombol simulasi
 * `Trigger Celebrate ($29.00 ARR)` untuk demo tanpa backend.
 *
 * Banner menampilkan nominal & gateway dari `milestone:first_sale` terakhir
 * (Stripe/Midtrans/stub — Fase 9) dengan fallback $29.00 untuk demo lokal.
 */
export function CelebrationOverlay(): ReactNode {
  const celebrating = useOffice((s) => s.celebrating);
  const celebrateAll = useOffice((s) => s.celebrateAll);
  const milestone = useBrain((s) => s.milestone);
  const [showBanner, setShowBanner] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const wasCelebrating = useRef(false);

  useEffect(() => {
    if (!celebrating) {
      // Berhenti celebrating sebelum timer 5.2s (mis. resetHome demo) harus
      // tetap menyembunyikan banner — jangan cuma membatalkan timer.
      wasCelebrating.current = false;
      setShowBanner(false);
      return undefined;
    }
    wasCelebrating.current = true;
    setShowBanner(true);

    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        const ctx = (audioRef.current ??= new Ctor());
        if (ctx.state === 'suspended') void ctx.resume();
        playFanfare(ctx);
      }
    } catch {
      // Audio diblokir browser — visual tetap jalan
    }

    const timer = setTimeout(() => setShowBanner(false), 5200);
    return () => clearTimeout(timer);
  }, [celebrating]);

  return (
    <>
      {/* Banner milestone */}
      <div
        className={`pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4 transition-all duration-500 ${
          showBanner ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'
        }`}
      >
        <div className="rounded-lg border border-secondary/50 bg-surface-container-lowest/90 px-6 py-3 text-center shadow-[0_0_48px_-12px_rgba(78,222,163,0.55)] backdrop-blur">
          <div className="font-mono text-label-xs uppercase tracking-[0.28em] text-secondary">
            {milestone ? `${milestone.paymentProvider} webhook` : 'payment webhook'} · paid ✓
          </div>
          <div className="mt-1 font-headline text-headline-md text-on-surface">
            FIRST CUSTOMER ACQUIRED{' '}
            <span className="font-mono text-secondary">
              ({milestone ? formatMoney(milestone.amount, milestone.currency) : '$29.00'} ARR)
            </span>
          </div>
          <div className="mt-0.5 font-mono text-mono-label text-on-surface-variant">
            Milestone #5 — autonomous loop terbukti end-to-end
          </div>
        </div>
      </div>

      {/* Tombol simulasi demo — di atas Founder Command Bar (var shell). */}
      <button
        type="button"
        onClick={(): void => celebrateAll()}
        disabled={celebrating}
        style={{ bottom: 'calc(1.25rem + var(--shell-bottom-space, 0px))' }}
        className={`fixed right-5 z-50 rounded-full border px-4 py-2 font-mono text-mono-label uppercase tracking-wider backdrop-blur transition-all duration-300 ${
          celebrating
            ? 'cursor-default border-secondary/40 bg-surface-container-high/70 text-on-surface-variant opacity-60'
            : 'cursor-pointer border-secondary/60 bg-surface-container-lowest/85 text-secondary shadow-[0_0_24px_-8px_rgba(78,222,163,0.6)] hover:bg-secondary hover:text-on-secondary'
        }`}
      >
        {celebrating ? '🎉 Celebrating…' : 'Trigger Celebrate ($29.00 ARR)'}
      </button>
    </>
  );
}
