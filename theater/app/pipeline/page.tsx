'use client';

import type { ReactNode } from 'react';

import { BrainBridge } from '@/components/BrainBridge';
import { PipelineView } from '@/components/pipeline/PipelineView';
import { AppShell } from '@/components/shell/AppShell';

/** Tab "Agent Pipeline & State" (kartu 📊) di dalam shell gabungan (kartu 🧩). */
export default function PipelinePage(): ReactNode {
  return (
    <AppShell>
      <BrainBridge />
      <PipelineView />
    </AppShell>
  );
}
