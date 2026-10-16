'use client';

import type { ReactNode } from 'react';

import { usePerf } from '@/store/perfStore';

const TARGET_FPS = 55; // "target 60.0" dengan toleransi vsync

function formatTris(triangles: number): string {
  if (triangles >= 1_000_000) return `${(triangles / 1_000_000).toFixed(1)}M`;
  if (triangles >= 1_000) return `${(triangles / 1_000).toFixed(1)}k`;
  return String(triangles);
}

/**
 * Overlay FPS + draw call — hanya tampil di dev mode (AC kartu
 * Performance). Di production `NODE_ENV` di-inline oleh Next sehingga
 * komponen ini tree-shake jadi null.
 */
export function PerfOverlay(): ReactNode {
  if (process.env.NODE_ENV !== 'development') return null;
  return <PerfOverlayContent />;
}

function PerfOverlayContent(): ReactNode {
  const fps = usePerf((s) => s.fps);
  const drawCalls = usePerf((s) => s.drawCalls);
  const triangles = usePerf((s) => s.triangles);

  const healthy = fps >= TARGET_FPS;

  return (
    <div className="pointer-events-none fixed bottom-5 left-5 z-50 rounded-md border border-white/10 bg-surface-container-lowest/85 px-3 py-2 font-mono text-mono-label text-on-surface-variant backdrop-blur">
      <span className="mr-3 uppercase tracking-widest text-outline">perf</span>
      <span className={healthy ? 'text-secondary' : 'text-tertiary'}>FPS {fps.toFixed(1)}</span>
      <span className="mx-2 text-outline-variant">│</span>
      DRAW {drawCalls}
      <span className="mx-2 text-outline-variant">│</span>
      TRI {formatTris(triangles)}
      <span className="mx-2 text-outline-variant">│</span>
      <span className={healthy ? 'text-secondary' : 'text-tertiary'}>target 60.0</span>
    </div>
  );
}
