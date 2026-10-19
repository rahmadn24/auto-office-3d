'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { simulateWebhook } from '@/lib/brainSocket';
import { formatMoney } from '@/lib/format';
import { GLASS } from '@/lib/ui';
import { StatusChip } from '@/components/ui/StatusChip';
import { useBrain } from '@/store/brainStore';

/* ───────────────────────── Primitives ───────────────────────── */

function Panel({
  title,
  children,
  className = '',
  accent,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  accent?: string;
}): ReactNode {
  return (
    <section className={`flex min-h-0 flex-col rounded-xl ${GLASS} ${className}`}>
      <header className="flex items-center gap-2 border-b border-grid-major/60 px-3 py-2">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: accent ?? '#38bdf8' }}
        />
        <h2 className="font-mono text-mono-label uppercase tracking-wide text-secondary">
          {title}
        </h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </section>
  );
}

function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: string }): ReactNode {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 font-mono text-[11px]">
      <span className="uppercase tracking-wide text-tertiary">{k}</span>
      <span style={{ color: tone ?? '#e2e8f0' }} className="truncate">
        {v}
      </span>
    </div>
  );
}

const TAGS: Array<{ key: string; label: string; division?: string }> = [
  { key: 'all', label: 'ALL' },
  { key: 'pm', label: 'PM', division: 'Product' },
  { key: 'dev', label: 'DEV', division: 'Engineering' },
  { key: 'qa', label: 'QA', division: 'QA' },
  { key: 'devops', label: 'DEVOPS', division: 'DevOps' },
  { key: 'mkt', label: 'MKT', division: 'Growth' },
];

/* ───────────────────── AGENT_RUNTIME_BUS ───────────────────── */

function RuntimeBus(): ReactNode {
  const feed = useBrain((s) => s.feed);
  const [filter, setFilter] = useState('all');
  const [streamOn, setStreamOn] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  // Saat STREAM OFF, tampilkan salinan feed beku (freeze) — bukan live.
  const [frozen, setFrozen] = useState<typeof feed>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const division = TAGS.find((t) => t.key === filter)?.division;
  const source = streamOn ? feed : frozen;
  const lines = useMemo(
    () => (division ? source.filter((f) => f.division === division) : source),
    [source, division],
  );

  useEffect(() => {
    if (autoScroll && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [lines, autoScroll]);

  const toggleStream = (): void => {
    if (streamOn) setFrozen(feed); // freeze snapshot saat dimatikan
    setStreamOn((v) => !v);
  };

  const dumpJson = (): void => {
    const blob = new Blob([JSON.stringify(lines, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `runtime-bus-${Date.now()}.json`;
    a.click();
    // Safari/Firefox membatalkan download bila object URL dicabut terlalu cepat.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return (
    <Panel title="Agent Runtime Bus" accent="#4edea3" className="row-span-2">
      {/* Filter division */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {TAGS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(t.key)}
            className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors"
            style={{
              borderColor: filter === t.key ? '#4edea3' : 'rgba(51,65,85,0.6)',
              color: filter === t.key ? '#4edea3' : '#64748b',
              backgroundColor: filter === t.key ? 'rgba(78,222,163,0.12)' : 'transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        ref={listRef}
        className="h-full max-h-[280px] overflow-y-auto rounded border border-grid-major/40 bg-black/30 p-2"
      >
        {lines.length === 0 ? (
          <div className="py-6 text-center font-mono text-mono-label uppercase tracking-wide text-tertiary">
            no runtime lines
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {lines.map((l) => (
              <li key={l.id} className="font-mono text-[10px] leading-relaxed">
                <span className="text-tertiary">{l.tsLabel}</span>{' '}
                <span
                  className="rounded px-1"
                  style={{ color: DIVISION_COLOR[l.division] ?? '#38bdf8' }}
                >
                  [{l.division.slice(0, 3).toUpperCase()}]
                </span>{' '}
                <span className="text-secondary">{l.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Kontrol (kartu 🖥️): STREAM ON/OFF, FLUSH, DUMP JSON, auto-scroll */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <CtlBtn on={streamOn} onClick={toggleStream}>
          STREAM {streamOn ? 'ON' : 'OFF'}
        </CtlBtn>
        <CtlBtn onClick={() => setFrozen([])}>FLUSH</CtlBtn>
        <CtlBtn onClick={dumpJson}>DUMP JSON</CtlBtn>
        <CtlBtn on={autoScroll} onClick={() => setAutoScroll((v) => !v)}>
          AUTO-SCROLL {autoScroll ? 'ON' : 'OFF'}
        </CtlBtn>
      </div>
    </Panel>
  );
}

function CtlBtn({
  children,
  onClick,
  on,
}: {
  children: ReactNode;
  onClick: () => void;
  on?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors"
      style={{
        borderColor: on ? '#4edea3' : 'rgba(51,65,85,0.6)',
        color: on ? '#4edea3' : '#64748b',
      }}
    >
      {children}
    </button>
  );
}

const DIVISION_COLOR: Record<string, string> = {
  Product: '#818cf8',
  Engineering: '#10b981',
  QA: '#06b6d4',
  DevOps: '#f59e0b',
  Growth: '#ec4899',
};

/* ───────────────────── CI/CD build pipeline ───────────────────── */

function CICDPanel(): ReactNode {
  const deploy = useBrain((s) => s.deploy);
  const steps = deploy?.buildSteps ?? [];
  return (
    <Panel title="CI/CD Pipeline" accent="#38bdf8">
      {steps.length === 0 ? (
        <div className="py-4 text-center font-mono text-mono-label uppercase tracking-wide text-tertiary">
          waiting for build…
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {steps.map((s, i) => (
            <li key={`${s.label}-${i}`} className="flex items-center gap-2 font-mono text-[11px]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  backgroundColor:
                    s.status === 'done'
                      ? '#4edea3'
                      : s.status === 'running'
                        ? '#f59e0b'
                        : '#334155',
                }}
              />
              <span className={s.status === 'pending' ? 'text-tertiary' : 'text-secondary'}>
                {s.label}
              </span>
              {i < steps.length - 1 ? <span className="text-tertiary">→</span> : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────────── Active Edge Deployment ───────────────── */

function DeploymentPanel(): ReactNode {
  const deploy = useBrain((s) => s.deploy);
  const online = deploy?.status === 'ready';
  const health = deploy?.health;
  return (
    <Panel title="Active Edge Deployment" accent={online ? '#4edea3' : '#f59e0b'}>
      <div className="mb-2 flex items-center gap-2">
        <StatusChip
          label={online ? 'ONLINE' : (deploy?.status ?? 'IDLE').toUpperCase()}
          color={online ? '#4edea3' : '#f59e0b'}
        />
        {health?.sslValid ? (
          <span className="font-mono text-[10px] uppercase text-tertiary">SSL VALID</span>
        ) : null}
      </div>
      <Row k="Live URL" v={deploy?.liveUrl || '—'} tone="#38bdf8" />
      <Row k="Repo" v={deploy?.repoName || '—'} />
      <Row k="TTFB" v={health ? `${health.ttfbMs}ms` : '—'} />
      <Row
        k="Root"
        v={health ? (health.rootOk ? '200 OK' : 'FAIL') : '—'}
        tone={health?.rootOk ? '#4edea3' : undefined}
      />
      <Row
        k="API"
        v={health ? (health.apiOk ? '200 OK' : 'FAIL') : '—'}
        tone={health?.apiOk ? '#4edea3' : undefined}
      />
      <Row k="Uptime" v={`${deploy?.uptimeS ?? 0}s`} />
      <Row k="Bandwidth" v={`${deploy?.bandwidthMb ?? 0} MB`} />
      <Row
        k="Edge Cache"
        v={deploy?.edgeCache ? 'HIT' : 'MISS'}
        tone={deploy?.edgeCache ? '#4edea3' : undefined}
      />
    </Panel>
  );
}

/* ───────────── Sales & Webhook Sentinel ───────────── */

function SalesPanel(): ReactNode {
  const revenue = useBrain((s) => s.revenue);
  const hasCustomers = useBrain((s) => s.hasCustomers);
  const milestone = useBrain((s) => s.milestone);
  return (
    <Panel title="Sales & Payment Sentinel" accent="#ec4899">
      {hasCustomers ? (
        <div className="mb-2 rounded border border-[rgba(78,222,163,0.4)] bg-[rgba(78,222,163,0.08)] px-2 py-1.5 font-mono text-[11px] text-[#4edea3]">
          FIRST CUSTOMER ACQUIRED
          {milestone
            ? ` · ${formatMoney(milestone.amount, milestone.currency)} · ${milestone.paymentProvider}`
            : ''}
        </div>
      ) : null}
      <Row k="Active Visitors" v={revenue?.activeVisitors ?? 0} />
      <Row k="Checkout Sessions" v={revenue?.checkoutSessions ?? 0} />
      <Row
        k="Gross ARR"
        v={formatMoney(revenue?.grossRevenueArr ?? 0, revenue?.currency ?? 'USD')}
        tone="#ec4899"
      />
      <Row k="Sales" v={revenue?.salesCount ?? 0} />
      <Row
        k="Signature"
        v={revenue?.signatureVerified ? 'SIGNATURE OK' : 'UNVERIFIED'}
        tone={revenue?.signatureVerified ? '#4edea3' : '#f59e0b'}
      />
      <Row k="Last Event" v={revenue?.lastEvent || '—'} />
      <button
        type="button"
        onClick={() => simulateWebhook()}
        className="mt-2 w-full rounded border border-[rgba(236,72,153,0.5)] bg-[rgba(236,72,153,0.1)] px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide text-[#ec4899] transition-colors hover:bg-[rgba(236,72,153,0.2)]"
      >
        Simulate Payment (driver aktif)
      </button>
    </Panel>
  );
}

/* ───────────── Social Campaign Dispatcher ───────────── */

function SocialPanel(): ReactNode {
  const social = useBrain((s) => s.social);
  return (
    <Panel title="Social Campaign Dispatcher" accent="#f59e0b">
      {social.length === 0 ? (
        <div className="py-4 text-center font-mono text-mono-label uppercase tracking-wide text-tertiary">
          no posts yet
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {social.map((p, i) => (
            <li
              key={`${p.queueId}-${i}`}
              className="rounded border border-grid-major/40 bg-black/20 px-2 py-1.5"
            >
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wide">
                <span
                  className="rounded px-1"
                  style={{
                    backgroundColor:
                      p.platform === 'x' ? 'rgba(56,189,248,0.15)' : 'rgba(236,72,153,0.15)',
                    color: p.platform === 'x' ? '#38bdf8' : '#ec4899',
                  }}
                >
                  {p.platform === 'x' ? 'X / TWITTER' : 'THREADS'}
                </span>
                <span style={{ color: p.status === 'published' ? '#4edea3' : '#f59e0b' }}>
                  {p.status.toUpperCase()}
                </span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-tertiary">queue {p.queueId}</div>
              <div className="mt-0.5 font-mono text-[10px] text-secondary">
                {p.metrics.impressions} impr · {p.metrics.clicks} clicks · {p.metrics.retweets} RT
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-tertiary">
                sentiment: <span className="text-[#4edea3]">{p.sentiment}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────── Bottom bar LIVE URL (kartu ▲) ───────────── */

function LiveUrlBar(): ReactNode {
  const deploy = useBrain((s) => s.deploy);
  const liveUrl = deploy?.status === 'ready' ? deploy.liveUrl : '';
  return (
    <div
      className={`pointer-events-auto absolute bottom-16 left-3 z-30 flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-mono-label uppercase tracking-wide md:bottom-3 ${GLASS}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${liveUrl ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: liveUrl ? '#4edea3' : '#64748b' }}
      />
      <span className="text-tertiary">LIVE URL</span>
      {liveUrl ? (
        <>
          <span className="text-secondary">{liveUrl}</span>
          <a
            href={`https://${liveUrl}`}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-grid-major/60 px-1.5 py-0.5 text-tertiary transition-colors hover:text-secondary"
          >
            OPEN ↗
          </a>
        </>
      ) : (
        <span className="text-tertiary">—</span>
      )}
    </div>
  );
}

/* ───────────────────── Root view ───────────────────── */

/** View "Terminal & Deployments" (kartu 🖥️) — merangkum realtime logs + pipeline. */
export function TerminalView(): ReactNode {
  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-canvas-base p-4 pb-20 md:pb-4 xl:p-8`}
    >
      <div className="grid h-full grid-cols-1 gap-3 xl:gap-6 md:grid-cols-2 xl:grid-cols-3">
        <RuntimeBus />
        <div className="flex min-h-0 flex-col gap-3 xl:gap-6">
          <CICDPanel />
          <DeploymentPanel />
        </div>
        <div className="flex min-h-0 flex-col gap-3">
          <SalesPanel />
          <SocialPanel />
        </div>
      </div>
      <LiveUrlBar />
    </div>
  );
}
