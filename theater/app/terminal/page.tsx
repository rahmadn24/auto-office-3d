'use client';

import type { ReactNode } from 'react';

import { BrainBridge } from '@/components/BrainBridge';
import { AppShell } from '@/components/shell/AppShell';
import { TerminalView } from '@/components/terminal/TerminalView';

/** Tab "Terminal & Deployments" (kartu 🖥️) di dalam shell gabungan (kartu 🧩). */
export default function TerminalPage(): ReactNode {
  return (
    <AppShell>
      <BrainBridge />
      <TerminalView />
    </AppShell>
  );
}
