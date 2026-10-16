'use client';

import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';

const OfficeScene = dynamic(() => import('../components/scene/OfficeScene'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-canvas-base">
      <div className="flex items-center gap-2 rounded-full bg-surface-container-high/70 px-4 py-2 font-mono text-mono-label text-secondary">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" />
        MOUNTING 3D VIEWPORT…
      </div>
    </div>
  ),
});

/** Halaman utama Theater — kanvas 3D hanya di-mount di client (WebGL tanpa SSR). */
export default function HomePage(): ReactNode {
  return (
    <main className="fixed inset-0 overflow-hidden bg-canvas-base">
      <OfficeScene />
    </main>
  );
}
