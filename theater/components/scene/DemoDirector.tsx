'use client';

import { useEffect, type ReactNode } from 'react';

import { AGENT_ROSTER, useOffice } from '@/store/officeStore';

/**
 * Sutradara demo Fase 2 — mensimulasikan alur PRD §1 tanpa backend:
 * prompt Founder → semua agen WORKING → kembali overview →
 * FIRST SALE → semua berjalan ke hub_00 lalu CELEBRATE → pulang.
 *
 * Fase 3 akan mengganti timer ini dengan event Socket.io
 * (directives/agent_status/milestone dari Brain).
 */
export function DemoDirector(): ReactNode {
  const setState = useOffice((s) => s.setState);
  const setCameraPreset = useOffice((s) => s.setCameraPreset);
  const celebrateAll = useOffice((s) => s.celebrateAll);
  const resetHome = useOffice((s) => s.resetHome);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [
      // Prompt awal → preset cinematic Founder (auto-focus PRD §4.3)
      setTimeout(() => setCameraPreset('founder'), 600),

      // Build phase: semua agen mengetik (WORKING), kamera ke Dev Lab
      setTimeout(() => {
        for (const entry of AGENT_ROSTER) {
          setState(
            entry.id,
            'WORKING',
            entry.id === 'pm_agent'
              ? 'Synthesizing PRD specs…'
              : entry.id === 'qa_agent'
                ? 'Running Vitest watch…'
                : 'Working on assigned ticket…',
          );
        }
        setCameraPreset('devLab');
      }, 4500),

      setTimeout(() => setCameraPreset('overview'), 9500),

      // Milestone: first sale → berjalan ke hub lalu CELEBRATE + konfeti
      setTimeout(() => {
        setCameraPreset('overview');
        celebrateAll();
      }, 14000),

      // Kembali ke kursi masing-masing
      setTimeout(() => resetHome('Back at station · IDLE'), 21000),
    ];

    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [setState, setCameraPreset, celebrateAll, resetHome]);

  return null;
}
