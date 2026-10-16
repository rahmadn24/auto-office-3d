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

export function DivisionSidebar(): ReactNode {
  const agents = useBrain((s) => s.agents);

  return (
    <>
      {/* Desktop ≥1280px — panel 280px, margin 2rem (DESIGN.md). */}
      <aside
        className={`absolute left-8 top-8 z-20 hidden w-[280px] flex-col overflow-hidden rounded-xl xl:flex ${GLASS}`}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/8 px-3 py-2">
          <h2 className="font-mono text-mono-label uppercase tracking-wide text-[#94a3b8]">
            Agent Division Sidebar
          </h2>
          <span className="font-mono text-[9px] uppercase tracking-wide text-[#475569]">280px</span>
        </header>
        <ul className="flex flex-col gap-1.5 p-3">
          {DIVISIONS.map(({ id, label, role, color, icon }) => {
            const a = agents[id];
            const action = a?.currentAction ?? 'idle';
            const stColor = STATUS_COLOR[action] ?? '#475569';
            return (
              <li key={id} className="rounded-lg border border-white/6 bg-black/20 p-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="text-[12px]" style={{ color }}>
                      {icon}
                    </span>
                    <span className="font-mono text-label-xs uppercase tracking-wide text-[#f8fafc]">
                      {label}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-wide text-[#475569]">
                      {role}
                    </span>
                  </span>
                  <StatusChip label={action} color={stColor} pulse={action !== 'idle'} />
                </div>
                <p className="mt-1 line-clamp-2 font-mono text-[10px] leading-snug text-[#94a3b8]">
                  {a?.logMessage ?? '—'}
                </p>
              </li>
            );
          })}
        </ul>
        <footer className="border-t border-white/6 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wide text-[#475569]">
          gutter 1.5rem · margin 2rem
        </footer>
      </aside>

      {/* Tablet 768–1279px — icon-only rail. */}
      <nav
        aria-label="Agent divisions"
        className={`absolute left-6 top-8 z-20 hidden w-12 flex-col items-center gap-2 rounded-xl p-2 md:flex xl:hidden ${GLASS}`}
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
