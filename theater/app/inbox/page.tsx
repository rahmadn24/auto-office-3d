'use client';

import type { ReactNode } from 'react';

import { CsInbox } from '@/components/cs/CsInbox';
import { AppShell } from '@/components/shell/AppShell';

/** Tab "CS Inbox" (kartu 💬 Fase 11) — omnichannel lead + closing flow. */
export default function InboxPage(): ReactNode {
  return (
    <AppShell>
      <CsInbox />
    </AppShell>
  );
}
