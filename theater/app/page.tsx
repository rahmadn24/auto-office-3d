'use client';

import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';

import { PmChatDock } from '../components/briefing/PmChatDock';
import { DivisionSidebar } from '../components/overlays/DivisionSidebar';
import { AgentStream } from '../components/overlays/AgentStream';
import { CameraPresets } from '../components/overlays/CameraPresets';
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
      <OfficeScene />
      <CelebrationOverlay />
      <PerfOverlay />
      {/* Pemilih 5 preset kamera cinematic (PRD §4.3) — meeting/devOps terjangkau. */}
      <CameraPresets />
      {/* Layout DESIGN.md: kolom kiri — sidebar divisi di atas, floating chat PM
          (Briefing Room) di bawahnya. xl: 280px; tablet: rail 48px + chat 300px;
          mobile: chat mengambang di atas bottom dock. */}
      <div className="pointer-events-none absolute inset-x-4 bottom-16 z-20 flex flex-col justify-end gap-3 md:inset-x-auto md:bottom-4 md:left-6 md:top-8 md:w-[300px] md:justify-start xl:left-8 xl:w-[280px]">
        <div className="pointer-events-auto flex min-h-0 flex-col overflow-hidden">
          <DivisionSidebar anchored={false} />
        </div>
        {/* Chat PM bisa diciutkan jadi pill/FAB — composer + GO pindah dari tab
            Briefing lama (route /briefing kini redirect ke office). */}
        <PmChatDock />
      </div>
      {/* Right-rail: Agent Stream feed mentah (PRD §5.1). */}
      <AgentStream />
    </AppShell>
  );
}
