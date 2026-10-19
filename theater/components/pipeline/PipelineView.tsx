'use client';

import { useState, type ReactNode } from 'react';

import { setGraphHalt } from '@/lib/brainSocket';
import { formatTokens } from '@/lib/format';
import type { AgentId } from '@/lib/events';
import { GLASS } from '@/lib/ui';
import { StatusChip } from '@/components/ui/StatusChip';
import { useBrain } from '@/store/brainStore';

/* ───────────────────────── Primitives ───────────────────────── */

function Panel({
  title,
  children,
  className = '',
  accent = '#38bdf8',
}: {
  title: string;
  children: ReactNode;
  className?: string;
  accent?: string;
}): ReactNode {
  return (
    <section className={`flex min-h-0 flex-col rounded-lg ${GLASS} ${className}`}>
      <header className="flex shrink-0 items-center gap-2 border-b border-white/6 px-3 py-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
        <h2 className="font-mono text-mono-label uppercase tracking-wide text-[#94a3b8]">
          {title}
        </h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </section>
  );
}

/* ───────────────────── Header: node/cycles/breaker ───────────────────── */

const NODE_OF_ACTION: Record<string, string> = {
  discussing: 'PM Agent',
  coding: 'Dev Agent',
  testing: 'QA Agent',
  deploying: 'DevOps',
  marketing: 'GTM',
  celebrating: 'GTM',
  idle: 'Idle',
  walking: 'Transit',
};

function PipelineHeader(): ReactNode {
  const agents = useBrain((s) => s.agents);
  const runStage = useBrain((s) => s.runStage);
  const halted = useBrain((s) => s.control?.haltedAll ?? false);

  // Node aktif = agen yang sedang beraksi (currentAction non-idle terakhir).
  const active = Object.values(agents).find(
    (a) => a && a.currentAction !== 'idle' && a.currentAction !== 'walking',
  );
  const activeNode = active
    ? (NODE_OF_ACTION[active.currentAction] ?? active.currentAction)
    : (runStage ?? 'Idle');
  // Siklus aktif loop Dev⇄QA dari payload iterationCycle.
  const cycleAgent = agents.qa_agent ?? agents.dev_agent;
  const cur = cycleAgent?.iterationCycle?.current ?? 0;
  const max = cycleAgent?.iterationCycle?.max ?? 5;
  const tripped = cur >= max;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg px-3 py-2 font-mono text-mono-label uppercase tracking-wide ${GLASS}`}
    >
      <span className="flex items-center gap-1.5">
        <span className="text-[#94a3b8]">Active Node</span>
        <span className="text-[#38bdf8]">{activeNode}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-[#94a3b8]">Graph Cycles</span>
        <span className="text-[#f8fafc]">{cur}/50</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-[#94a3b8]">Circuit Breaker</span>
        <span style={{ color: tripped ? '#ef4444' : '#4edea3' }}>
          {tripped ? 'TRIPPED' : 'ARMED'} ({cur}/{max})
        </span>
      </span>
      <button
        type="button"
        onClick={() => setGraphHalt(!halted)}
        className="ml-auto rounded border px-2 py-1 font-mono text-label-xs uppercase tracking-wide transition-colors"
        style={{
          borderColor: halted ? '#4edea3' : 'rgba(239,68,68,0.5)',
          color: halted ? '#4edea3' : '#ef4444',
          backgroundColor: halted ? 'rgba(78,222,163,0.1)' : 'rgba(239,68,68,0.08)',
        }}
      >
        {halted ? '▶ Resume Graph' : '⏸ Halt Graph'}
      </button>
    </div>
  );
}

/* ───────────────────────── Graph node flow ───────────────────────── */

function GraphFlow(): ReactNode {
  const agents = useBrain((s) => s.agents);
  const active = Object.values(agents).find(
    (a) => a && a.currentAction !== 'idle' && a.currentAction !== 'walking',
  );
  const action = active?.currentAction;
  const cycleAgent = agents.qa_agent ?? agents.dev_agent;
  const cur = cycleAgent?.iterationCycle?.current ?? 0;
  const max = cycleAgent?.iterationCycle?.max ?? 5;

  const nodes = [
    { id: 'founder', label: 'Founder Input', on: action === 'discussing', sub: 'directive' },
    { id: 'pm', label: 'PM Agent', on: action === 'discussing', sub: 'PRD' },
    {
      id: 'loop',
      label: 'Team 2 · Active Loop',
      on: action === 'coding' || action === 'testing',
      sub: `Dev ⇄ QA · Cycle ${cur}/${max}`,
    },
    {
      id: 'devops',
      label: 'DevOps',
      on: action === 'deploying',
      sub: action === 'deploying' ? 'deploying' : 'standby',
    },
    {
      id: 'gtm',
      label: 'GTM',
      on: action === 'marketing' || action === 'celebrating',
      sub: action === 'celebrating' ? 'celebrate' : 'launch',
    },
  ];

  return (
    <Panel title="LangGraph · Orchestration Flow">
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {nodes.map((n, i) => (
          <div key={n.id} className="flex flex-1 items-center gap-2">
            <div
              className="flex min-w-0 flex-1 flex-col rounded-md border px-2.5 py-2 transition-colors"
              style={{
                borderColor: n.on ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.08)',
                backgroundColor: n.on ? 'rgba(56,189,248,0.1)' : 'transparent',
                boxShadow: n.on ? '0 0 16px rgba(56,189,248,0.15)' : 'none',
              }}
            >
              <span
                className="truncate font-mono text-label-xs uppercase tracking-wide"
                style={{ color: n.on ? '#38bdf8' : '#f8fafc' }}
              >
                {n.label}
              </span>
              <span className="truncate font-mono text-[10px] uppercase tracking-wide text-[#475569]">
                {n.sub}
              </span>
            </div>
            {i < nodes.length - 1 ? <span className="shrink-0 text-[#475569]">→</span> : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ───────────────────────── Agent cards ───────────────────────── */

const AGENTS: Array<{ id: AgentId; name: string; role: string; color: string }> = [
  { id: 'pm_agent', name: 'PM', role: 'Product', color: '#818cf8' },
  { id: 'dev_agent', name: 'Dev', role: 'Engineering', color: '#10b981' },
  { id: 'qa_agent', name: 'QA', role: 'QA', color: '#06b6d4' },
  { id: 'devops_agent', name: 'DevOps', role: 'Infra', color: '#f59e0b' },
  { id: 'marketing_agent', name: 'GTM', role: 'Growth', color: '#ec4899' },
];

const STATUS_OF_ACTION: Record<string, { label: string; color: string }> = {
  idle: { label: 'IDLE', color: '#475569' },
  walking: { label: 'TRANSIT', color: '#94a3b8' },
  discussing: { label: 'WRITING', color: '#818cf8' },
  coding: { label: 'WRITING', color: '#10b981' },
  testing: { label: 'TESTING', color: '#06b6d4' },
  deploying: { label: 'DEPLOYING', color: '#f59e0b' },
  marketing: { label: 'PREPARING', color: '#ec4899' },
  celebrating: { label: 'CELEBRATE', color: '#4edea3' },
};

function AgentCards(): ReactNode {
  const agents = useBrain((s) => s.agents);
  return (
    <Panel title="Agent Nodes" accent="#4edea3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {AGENTS.map(({ id, name, role, color }) => {
          const a = agents[id];
          const st = STATUS_OF_ACTION[a?.currentAction ?? 'idle'] ?? {
            label: 'IDLE',
            color: '#475569',
          };
          return (
            <div key={id} className="rounded-md border border-white/8 bg-black/20 p-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="font-mono text-label-xs uppercase tracking-wide text-[#f8fafc]">
                    {name}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[#475569]">
                    {role}
                  </span>
                </span>
                <StatusChip
                  label={st.label}
                  color={st.color}
                  pulse={st.label !== 'IDLE' && st.label !== 'TRANSIT'}
                />
              </div>
              <p className="mt-1.5 line-clamp-2 font-mono text-[10px] leading-snug text-[#94a3b8]">
                {a?.logMessage ?? '—'}
              </p>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ───────────────────── Vector DB inspector ───────────────────── */

const NAMESPACES = [
  { ns: 'pm-memory', label: 'PM Memory', color: '#818cf8' },
  { ns: 'dev-memory', label: 'Dev Memory', color: '#10b981' },
  { ns: 'qa-memory', label: 'QA Memory', color: '#06b6d4' },
  { ns: 'marketing-mem', label: 'Marketing', color: '#ec4899' },
];

function VectorInspector(): ReactNode {
  const sizes = useBrain((s) => s.memorySizes);
  const retrievals = useBrain((s) => s.retrievals);
  const stream = [...retrievals].reverse().slice(0, 8);
  return (
    <Panel title="Vector DB Inspector · Pinecone" accent="#818cf8">
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        {NAMESPACES.map(({ ns, label, color }) => (
          <div key={ns} className="rounded border border-white/6 bg-black/20 px-2 py-1.5">
            <div className="font-mono text-[10px] uppercase tracking-wide text-[#475569]">
              {label}
            </div>
            <div className="font-mono text-[13px]" style={{ color }}>
              {sizes[ns] ?? 0}
              <span className="ml-1 text-[10px] text-[#475569]">vec</span>
            </div>
          </div>
        ))}
      </div>
      <div className="font-mono text-label-xs uppercase tracking-wide text-[#94a3b8]">
        Recent Retrieval Stream
      </div>
      {stream.length === 0 ? (
        <div className="py-3 text-center font-mono text-[10px] uppercase tracking-wide text-[#475569]">
          no retrievals yet
        </div>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {stream.map((r, i) => (
            <li
              key={`${r.topId}-${i}`}
              className="rounded border border-white/6 bg-black/20 px-2 py-1"
            >
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="truncate text-[#94a3b8]">{r.namespace}</span>
                <span style={{ color: r.topScore > 0.85 ? '#4edea3' : '#ffb95f' }}>
                  cos {r.topScore.toFixed(3)}
                </span>
              </div>
              <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(0, Math.min(1, r.topScore)) * 100}%`,
                    backgroundColor: r.topScore > 0.85 ? '#4edea3' : '#ffb95f',
                  }}
                />
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-[#475569]">
                “{r.query}” → {r.topId ?? '∅'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────────────── Loop Controls ───────────────────── */

function LoopControls(): ReactNode {
  const tokens = useBrain((s) => s.tokens);
  const clearRetrievals = useBrain((s) => s.clearRetrievals);
  const [breaker, setBreaker] = useState(5);
  const [crossRun, setCrossRun] = useState(true);
  const BUDGET = 250_000;
  const quota = Math.min(100, (tokens / BUDGET) * 100);

  return (
    <Panel title="Loop Controls" accent="#ffb95f">
      <label className="mb-2 block">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wide">
          <span className="text-[#94a3b8]">Max Retry Breaker</span>
          <span className="text-[#ffb95f]">{breaker}x</span>
        </div>
        <input
          type="range"
          min={1}
          max={10}
          value={breaker}
          onChange={(e) => setBreaker(Number(e.target.value))}
          disabled
          title="Belum tersambung ke Brain (runtime config menyusul)"
          className="mt-1 w-full accent-[#ffb95f] opacity-50"
        />
      </label>

      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wide text-[#94a3b8]">
          Cross-Run Memory
        </span>
        <button
          type="button"
          onClick={() => setCrossRun((v) => !v)}
          disabled
          title="Belum tersambung ke Brain (runtime config menyusul)"
          className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors opacity-60"
          style={{
            borderColor: crossRun ? '#4edea3' : 'rgba(255,255,255,0.12)',
            color: crossRun ? '#4edea3' : '#94a3b8',
          }}
        >
          {crossRun ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="mb-2">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wide">
          <span className="text-[#94a3b8]">API Quota · Tokens</span>
          <span className="text-[#818cf8]">
            {formatTokens(tokens)} / {formatTokens(BUDGET)}
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div className="h-full rounded-full bg-[#818cf8]" style={{ width: `${quota}%` }} />
        </div>
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={clearRetrievals}
          className="flex-1 rounded border border-white/12 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[#f8fafc] transition-colors hover:bg-white/5"
        >
          Flush Retrievals
        </button>
        <button
          type="button"
          onClick={() => setGraphHalt(false)}
          title="Melepas GRAPH LOCKED — melanjutkan graph yang di-halt (control:resume)"
          className="flex-1 rounded border border-[rgba(78,222,163,0.4)] px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[#4edea3] transition-colors hover:bg-[rgba(78,222,163,0.1)]"
        >
          Resume Graph
        </button>
      </div>
    </Panel>
  );
}

/* ───────────────────────── Root view ───────────────────────── */

/** View "Agent Pipeline & State" (kartu 📊) — graf LangGraph + vector DB + loop controls. */
export function PipelineView(): ReactNode {
  return (
    <div className="h-full w-full overflow-y-auto p-4 pb-20 md:pb-4 xl:p-8">
      <div className="flex flex-col gap-3 xl:gap-6">
        <PipelineHeader />
        <GraphFlow />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 xl:gap-6">
          <div className="flex flex-col gap-3 lg:col-span-2 xl:gap-6">
            <AgentCards />
          </div>
          <div className="flex flex-col gap-3 xl:gap-6">
            <VectorInspector />
            <LoopControls />
          </div>
        </div>
      </div>
    </div>
  );
}
