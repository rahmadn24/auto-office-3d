'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useBrain } from '@/store/brainStore';

const DIVISION_ACCENT: Record<string, string> = {
  Product: '#818cf8',
  Engineering: '#10b981',
  QA: '#06b6d4',
  DevOps: '#f59e0b',
  Growth: '#ec4899',
};

/** Badge status koneksi — PRD §2.1: "SOCKET.IO CONNECTED · BRAIN V1.4" + PING. */
export function ConnectionBadge(): ReactNode {
  const connection = useBrain((s) => s.connection);
  const pingMs = useBrain((s) => s.pingMs);
  const version = useBrain((s) => s.brainVersion);
  const latencyMs = useBrain((s) => s.latencyMs);
  const bestLatencyMs = useBrain((s) => s.bestLatencyMs);

  const connected = connection === 'connected';
  const dot = connected ? '#4edea3' : connection === 'connecting' ? '#f59e0b' : '#ef4444';
  const label =
    connection === 'connected'
      ? 'SOCKET.IO CONNECTED'
      : connection === 'connecting'
        ? 'SOCKET.IO CONNECTING'
        : connection === 'reconnecting'
          ? 'SOCKET.IO RECONNECTING'
          : 'SOCKET.IO OFFLINE · DEMO MODE';

  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-grid-major/60 bg-surface-container-high/85 px-3 py-1.5 font-mono text-mono-label uppercase tracking-wide text-secondary backdrop-blur-sm">
      <span
        className={`h-1.5 w-1.5 rounded-full ${connected ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: dot }}
      />
      <span>{label}</span>
      {version ? <span className="text-tertiary">· BRAIN V{version}</span> : null}
      {pingMs !== null ? (
        <span className="text-tertiary">
          · PING <span className="text-secondary">{pingMs}MS</span>
        </span>
      ) : null}
      {latencyMs !== null ? (
        <span className="text-tertiary">
          · SYNC{' '}
          <span className="text-secondary">
            {Math.max(0, latencyMs)}
            MS
          </span>
          {bestLatencyMs !== null ? (
            <span className="text-tertiary"> (best {Math.max(0, bestLatencyMs)}MS)</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** Agent Stream right-rail — feed telemetry mentah (PRD: raw event feed). */
export function AgentStream(): ReactNode {
  const feed = useBrain((s) => s.feed);
  const connection = useBrain((s) => s.connection);
  const runStage = useBrain((s) => s.runStage);
  const tokens = useBrain((s) => s.tokens);
  const hasCustomers = useBrain((s) => s.hasCustomers);
  const eventCount = useBrain((s) => s.eventCount);
  const clearFeed = useBrain((s) => s.clearFeed);

  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  // events/sec: jepret eventCount tiap detik, tampilkan delta.
  const [eps, setEps] = useState(0);
  const lastCountRef = useRef(eventCount);

  useEffect(() => {
    const id = setInterval(() => {
      const delta = eventCount - lastCountRef.current;
      lastCountRef.current = eventCount;
      setEps(delta);
    }, 1000);
    return () => clearInterval(id);
  }, [eventCount]);

  useEffect(() => {
    if (autoScroll && listRef.current) listRef.current.scrollTop = 0;
  }, [feed, autoScroll]);

  const syncPct = connection === 'connected' ? 100 : 0;

  return (
    <aside className="pointer-events-auto absolute right-3 top-3 bottom-3 flex w-[320px] flex-col rounded-xl border border-grid-major/60 bg-surface-container-high/85 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-grid-major/60 px-3 py-2">
        <div className="font-mono text-mono-label uppercase tracking-wide text-secondary">
          Agent Stream
        </div>
        <div className="flex items-center gap-1.5 font-mono text-mono-label text-tertiary">
          <span
            className="rounded px-1"
            style={{
              backgroundColor: syncPct === 100 ? 'rgba(78,222,163,0.15)' : 'rgba(239,68,68,0.15)',
              color: syncPct === 100 ? '#4edea3' : '#ef4444',
            }}
          >
            SYNC {syncPct}%
          </span>
          <span>{eps} EV/S</span>
        </div>
      </div>

      {/* Meta bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-grid-major/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-tertiary">
        <span>
          STAGE <span className="text-secondary">{runStage ?? '—'}</span>
        </span>
        <span>
          TOKENS <span className="text-secondary">{tokens.toLocaleString()}</span>
        </span>
        <span>
          EVENT <span className="text-secondary">{eventCount}</span>
        </span>
        {hasCustomers ? (
          <span className="rounded bg-[rgba(78,222,163,0.15)] px-1 text-[#4edea3]">
            HAS CUSTOMERS
          </span>
        ) : null}
      </div>

      {/* Feed list */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-2">
        {feed.length === 0 ? (
          <div className="px-1 py-6 text-center font-mono text-mono-label uppercase tracking-wide text-tertiary">
            {connection === 'connected' ? 'Menunggu event brain…' : 'Belum terhubung ke brain'}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {feed.map((f) => (
              <li
                key={f.id}
                className="rounded-lg border border-grid-major/40 bg-surface-container-low/70 px-2 py-1.5"
              >
                <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wide">
                  <span
                    className="rounded px-1"
                    style={{
                      backgroundColor: `${DIVISION_ACCENT[f.division] ?? '#38bdf8'}22`,
                      color: DIVISION_ACCENT[f.division] ?? '#38bdf8',
                    }}
                  >
                    {f.agentId.replace('_', ' ')}
                  </span>
                  <span className="text-tertiary">{f.tsLabel}</span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-secondary">
                  {f.action} <span className="text-tertiary">→</span> {f.targetZone}
                </div>
                <div
                  className="mt-0.5 break-words font-mono text-[10px]"
                  style={{ color: DIVISION_ACCENT[f.division] ?? '#38bdf8' }}
                >
                  {f.detail}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer controls */}
      <div className="flex items-center justify-between border-t border-grid-major/60 px-3 py-2">
        <button
          type="button"
          onClick={() => setAutoScroll((v) => !v)}
          className="rounded border border-grid-major/60 px-2 py-1 font-mono text-mono-label uppercase tracking-wide text-tertiary transition-colors hover:text-secondary"
        >
          AUTO-SCROLL {autoScroll ? 'ON' : 'OFF'}
        </button>
        <button
          type="button"
          onClick={clearFeed}
          className="rounded border border-grid-major/60 px-2 py-1 font-mono text-mono-label uppercase tracking-wide text-tertiary transition-colors hover:text-secondary"
        >
          CLEAR FEED
        </button>
      </div>
    </aside>
  );
}
