'use client';

import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';

import { BrainBridge } from '../components/BrainBridge';
import { DivisionSidebar } from '../components/overlays/DivisionSidebar';
import { AgentStream } from '../components/overlays/AgentStream';
import { CelebrationOverlay } from '../components/overlays/CelebrationOverlay';
import { PerfOverlay } from '../components/overlays/PerfOverlay';
import { AppShell } from '../components/shell/AppShell';

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

/**
 * Tab "Office Theater (3D Live)" — kanvas 3D di dalam shell bersama
 * (kartu 🧩): header/tab/footer identik antar view, koneksi socket & store
 * tetap hidup karena tab = client-side route.
 */
export default function HomePage(): ReactNode {
  return (
    <AppShell>
      <BrainBridge />
      <OfficeScene />
      <CelebrationOverlay />
      <PerfOverlay />
      {/* Layout DESIGN.md: sidebar divisi kiri (280px desktop / rail tablet). */}
      <DivisionSidebar />
      {/* Right-rail: Agent Stream feed mentah (PRD §5.1). */}
      <AgentStream />
    </AppShell>
  );
}
