'use client';

import { useState, type ReactNode } from 'react';

import { cancelReplay, replayRun } from '@/lib/brainSocket';
import type { RunStatus } from '@/lib/events';
import { GLASS } from '@/lib/ui';
import { StatusChip } from '@/components/ui/StatusChip';
import { useReplay } from '@/store/replayStore';

/**
 * Panel "Run Replay" (kartu 10.4 — PRD §7): daftar run durable dari event log
 * + playback timeline. Demo client (putar ulang momen first sale) dan
 * debugging run gagal tanpa menjalankan ulang graph.
 */

const RUN_COLORS: Record<RunStatus, string> = {
  running: '#38bdf8',
  completed: '#4edea3',
  halted: '#ffb95f',
  failed: '#ef4444',
  interrupted: '#94a3b8',
};

const KIND_COLORS: Record<string, string> = {
  agent: '#818cf8',
  deploy: '#f59e0b',
  milestone: '#4edea3',
  revenue: '#4edea3',
  social: '#ec4899',
  retrieval: '#06b6d4',
  artifacts: '#38bdf8',
};

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const p = (n: number, len = 2): string => String(n).padStart(len, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function RunReplayPanel(): ReactNode {
  const runs = useReplay((s) => s.runs);
  const activeRunId = useReplay((s) => s.activeRunId);
  const playing = useReplay((s) => s.playing);
  const total = useReplay((s) => s.total);
  const received = useReplay((s) => s.received);
  const events = useReplay((s) => s.events);
  const error = useReplay((s) => s.error);
  const [busy, setBusy] = useState(false);

  const progress = total > 0 ? Math.min(100, (received / total) * 100) : 0;
  const timeline = [...events].reverse().slice(0, 40);

  const start = async (runId: string): Promise<void> => {
    setBusy(true);
    await replayRun(runId, { stepMs: 90 });
    setBusy(false);
  };

  return (
    <section className={`flex min-h-0 flex-col rounded-lg ${GLASS}`}>
      <header className="flex shrink-0 items-center gap-2 border-b border-white/6 px-3 py-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#38bdf8' }} />
        <h2 className="font-mono text-mono-label uppercase tracking-wide text-[#94a3b8]">
          Run Replay · Event Log
        </h2>
        {playing ? (
          <button
            type="button"
            onClick={cancelReplay}
            className="ml-auto rounded border border-[rgba(239,68,68,0.5)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#ef4444] transition-colors hover:bg-[rgba(239,68,68,0.1)]"
          >
            ⏹ Stop
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error ? (
          <p className="mb-2 rounded border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.08)] px-2 py-1 font-mono text-[10px] text-[#ef4444]">
            {error}
          </p>
        ) : null}

        {runs.length === 0 ? (
          <p className="py-3 text-center font-mono text-[10px] uppercase tracking-wide text-[#475569]">
            belum ada run durable — jalankan directive dulu
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {runs.slice(0, 6).map((run) => {
              const isActive = run.runId === activeRunId;
              return (
                <li
                  key={run.runId}
                  className="rounded border px-2 py-1.5"
                  style={{
                    borderColor: isActive ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.08)',
                    backgroundColor: isActive ? 'rgba(56,189,248,0.08)' : 'transparent',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#f8fafc]">
                      {run.projectName || run.runId}
                    </span>
                    <StatusChip
                      label={run.status}
                      color={RUN_COLORS[run.status]}
                      pulse={run.status === 'running'}
                    />
                    <button
                      type="button"
                      disabled={busy && !isActive}
                      onClick={() => (isActive && playing ? cancelReplay() : void start(run.runId))}
                      className="rounded border border-white/12 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#f8fafc] transition-colors hover:bg-white/5 disabled:opacity-40"
                    >
                      {isActive && playing ? '⏸' : '▶'}
                    </button>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-[#475569]">
                    <span>{run.runId}</span>
                    <span>· {run.stage || 'received'}</span>
                    <span>· {timeLabel(run.createdAt)}</span>
                    <span className="ml-auto">{(run.tokensUsed / 1000).toFixed(1)}k tok</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {activeRunId ? (
          <div className="mt-3">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wide text-[#94a3b8]">
              <span>{playing ? 'REPLAYING' : 'PLAYBACK DONE'}</span>
              <span>
                {received}/{total} events
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${progress}%`,
                  backgroundColor: playing ? '#38bdf8' : '#4edea3',
                }}
              />
            </div>
            <ul className="mt-2 flex flex-col gap-1">
              {timeline.map((event) => (
                <li
                  key={`${event.id}-${event.seq}`}
                  className="rounded border border-white/6 bg-black/20 px-2 py-1"
                >
                  <div className="flex items-center gap-2 font-mono text-[10px]">
                    <span className="text-[#475569]">{timeLabel(event.ts)}</span>
                    <span
                      className="uppercase tracking-wide"
                      style={{ color: KIND_COLORS[event.kind] ?? '#94a3b8' }}
                    >
                      {event.kind}
                    </span>
                    <span className="truncate text-[#94a3b8]">{event.agent ?? '—'}</span>
                    <span className="ml-auto text-[#475569]">#{event.seq}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 font-mono text-[10px] leading-snug text-[#cbd5e1]">
                    {event.message ?? JSON.stringify(event.payload ?? {})}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
