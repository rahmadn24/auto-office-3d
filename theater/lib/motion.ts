'use client';

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** Media query string — diekspor untuk test. */
export const REDUCED_MOTION_QUERY = QUERY;

/**
 * Baca preferensi reduced-motion dari objek mirip MediaQueryList.
 * Diekspor murni agar bisa diuji tanpa DOM (mock matchMedia).
 */
export function readReducedMotion(mql: { matches: boolean } | null | undefined): boolean {
  return mql?.matches === true;
}

function matchMediaSafe(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(QUERY);
}

/**
 * Hook `prefers-reduced-motion` (Fase 13 — aksesibilitas & motion).
 * Nilai awal dibaca sinkron saat mount; perubahan preferensi OS diikuti
 * lewat listener `change`. SSR/default: false (animasi normal).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => readReducedMotion(matchMediaSafe()));

  useEffect(() => {
    const mql = matchMediaSafe();
    if (!mql) return undefined;
    // Sinkronkan sekali lagi setelah mount (matchMedia bisa berubah dini).
    setReduced(readReducedMotion(mql));
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
