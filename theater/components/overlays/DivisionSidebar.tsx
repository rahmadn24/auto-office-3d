'use client';

import type { ReactNode } from 'react';

import { StatusChip } from '@/components/ui/StatusChip';
import { GLASS } from '@/lib/ui';
import type { AgentId } from '@/lib/events';
import { useBrain } from '@/store/brainStore';

/**
 * Sidebar Agent Division (DESIGN.md: 280px kiri desktop 1280px+,
 * icon-only rail di tablet 768–1279px, tersembunyi di mobile —
 * navigasi mobile via bottom dock, AC 📱).
 */

const DIVISIONS: Array<{ id: AgentId; label: string; role: string; color: string; icon: string }> =
  [
    { id: 'pm_agent', label: 'PM', role: 'Product', color: '#818cf8', icon: '◆' },
    { id: 'dev_agent', label: 'DEV', role: 'Engineering', color: '#10b981', icon: '⬢' },
    { id: 'qa_agent', label: 'QA', role: 'Quality', color: '#06b6d4', icon: '◇' },
    { id: 'devops_agent', label: 'DEVOPS', role: 'Infra', color: '#f59e0b', icon: '▲' },
    { id: 'marketing_agent', label: 'GTM', role: 'Growth', color: '#ec4899', icon: '✳' },
  ];

const STATUS_COLOR: Record<string, string> = {
  idle: '#475569',
  walking: '#94a3b8',
  discussing: '#818cf8',
  coding: '#10b981',
  testing: '#06b6d4',
  deploying: '#f59e0b',
  marketing: '#ec4899',
  celebrating: '#4edea3',
};

export function DivisionSidebar({ anchored = true }: { anchored?: boolean }): ReactNode {
  const agents = useBrain((s) => s.agents);
  // `anchored=false` → dipakai di kolom kiri bersama floating chat PM
  // (page.tsx): sidebar mengalir normal, chat mengambil sisa tinggi di bawahnya.
  const asidePos = anchored ? 'absolute left-8 top-8 z-20' : '';
  const railPos = anchored ? 'absolute left-6 top-8 z-20' : '';

  return (
    <>
      {/* Desktop ≥1280px — panel 280px, margin 2rem (DESIGN.md). */}
      <aside
        className={`${asidePos} hidden h-full min-h-0 w-[280px] flex-col overflow-hidden rounded-xl xl:flex ${GLASS}`}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/8 px-2.5 py-1.5">
          <h2 className="font-mono text-[9.5px] uppercase tracking-wide text-[#94a3b8]">
            Agent Division Sidebar
          </h2>
          <span className="font-mono text-[9px] uppercase tracking-wide text-[#475569]">
            5 divisi
          </span>
        </header>
        <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto p-2">
          {DIVISIONS.map(({ id, label, role, color, icon }) => {
            const a = agents[id];
            const action = a?.currentAction ?? 'idle';
            const stColor = STATUS_COLOR[action] ?? '#475569';
            return (
              <li key={id} className="rounded-lg border border-white/6 bg-black/20 px-2 py-0.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="text-[11px]" style={{ color }}>
                      {icon}
                    </span>
                    <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#f8fafc]">
                      {label}
                    </span>
                    <span className="truncate font-mono text-[8.5px] uppercase tracking-wide text-[#475569]">
                      {role}
                    </span>
                  </span>
                  <StatusChip label={action} color={stColor} pulse={action !== 'idle'} />
                </div>
                <p
                  className="mt-0.5 truncate font-mono text-[9.5px] leading-snug text-[#94a3b8]"
                  title={a?.logMessage ?? '—'}
                >
                  {a?.logMessage ?? '—'}
                </p>
              </li>
            );
          })}
        </ul>
        <footer className="shrink-0 border-t border-white/6 px-2.5 py-1 font-mono text-[8.5px] uppercase tracking-wide text-[#475569]">
          5 divisi · 6 agen · live telemetry
        </footer>
      </aside>

      {/* Tablet 768–1279px — icon-only rail. */}
      <nav
        aria-label="Agent divisions"
        className={`${railPos} hidden w-12 flex-col items-center gap-2 rounded-xl p-2 md:flex xl:hidden ${GLASS}`}
      >
        {DIVISIONS.map(({ id, label, color, icon }) => {
          const action = agents[id]?.currentAction ?? 'idle';
          const active = action !== 'idle' && action !== 'walking';
          return (
            <span
              key={id}
              title={`${label} · ${action}`}
              className="relative flex h-8 w-8 items-center justify-center rounded-lg text-[12px]"
              style={{ backgroundColor: `${color}1a`, color, border: `1px solid ${color}40` }}
            >
              {icon}
              <span
                className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${active ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: active ? color : '#475569' }}
              />
            </span>
          );
        })}
      </nav>
    </>
  );
}
