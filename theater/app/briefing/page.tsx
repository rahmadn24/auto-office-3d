'use client';

import type { ReactNode } from 'react';

import { BriefingRoom } from '@/components/briefing/BriefingRoom';
import { AppShell } from '@/components/shell/AppShell';

/** Tab "Briefing Room" (kartu 🎯 Fase 8) — diskusi Founder↔PM sebelum GO. */
export default function BriefingPage(): ReactNode {
  return (
    <AppShell>
      <BriefingRoom />
    </AppShell>
  );
}
