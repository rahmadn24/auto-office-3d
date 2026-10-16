'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';

import { BrainBridge } from '@/components/BrainBridge';
import { ConnectionBadge } from '@/components/overlays/AgentStream';
import { TerminalView } from '@/components/terminal/TerminalView';

/** Route "Terminal & Deployments" (kartu 🖥️). Menyambung Brain via socket. */
export default function TerminalPage(): ReactNode {
  return (
    <main className="fixed inset-0 overflow-hidden bg-canvas-base">
      <BrainBridge />
      <div className="pointer-events-none absolute left-3 top-3 z-40">
        <ConnectionBadge />
      </div>
      <div className="pointer-events-none absolute right-3 top-3 z-40">
        <Link
          href="/"
          className="pointer-events-auto rounded-full border border-grid-major/60 bg-surface-container-high/85 px-3 py-1.5 font-mono text-mono-label uppercase tracking-wide text-tertiary backdrop-blur-sm transition-colors hover:text-secondary"
        >
          ← 3D VIEWPORT
        </Link>
      </div>
      <TerminalView />
    </main>
  );
}
