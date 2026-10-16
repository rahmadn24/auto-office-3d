'use client';

import type { ReactNode } from 'react';

import { ArtifactsView } from '@/components/artifacts/ArtifactsView';
import { BrainBridge } from '@/components/BrainBridge';
import { AppShell } from '@/components/shell/AppShell';

/** Tab "Artifacts & PRD" (kartu 📄) di dalam shell gabungan (kartu 🧩). */
export default function ArtifactsPage(): ReactNode {
  return (
    <AppShell>
      <BrainBridge />
      <ArtifactsView />
    </AppShell>
  );
}
