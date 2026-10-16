'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { ConnectionBadge } from '@/components/overlays/AgentStream';
import { FounderCommandBar } from '@/components/shell/FounderCommandBar';
import { formatTokens } from '@/lib/format';
import { useBrain } from '@/store/brainStore';

/** Id tab = route (deep-linkable, PRD AC: URL route per tab). */
const TABS = [
  { href: '/', label: 'Office Theater', sub: '3D Live', key: 'office' },
  { href: '/pipeline', label: 'Agent Pipeline', sub: '& State', key: 'pipeline' },
  { href: '/artifacts', label: 'Artifacts', sub: '& PRD', key: 'artifacts' },
  { href: '/terminal', label: 'Terminal', sub: '& Deployments', key: 'terminal' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function tabKeyFor(path: string): TabKey {
  if (path.startsWith('/pipeline')) return 'pipeline';
  if (path.startsWith('/artifacts')) return 'artifacts';
  if (path.startsWith('/terminal')) return 'terminal';
  return 'office';
}

/** Statistik ringkas di header — identik antar tab (PRD AC). */
function HeaderStats(): ReactNode {
  const agents = useBrain((s) => s.agents);
  const tokens = useBrain((s) => s.tokens);
  const pingMs = useBrain((s) => s.pingMs);
  const count = Object.keys(agents).length;
  return (
    <div className="hidden items-center gap-3 font-mono text-mono-label uppercase tracking-wide sm:flex">
      <Stat k="Agents" v={String(count)} tone="#4edea3" />
      <Stat k="Tokens" v={formatTokens(tokens)} tone="#818cf8" />
      <Stat k="Ping" v={pingMs == null ? '—' : `${pingMs}ms`} tone="#ffb95f" />
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone: string }): ReactNode {
  return (
    <span className="flex items-center gap-1">
      <span className="text-tertiary">{k}</span>
      <span style={{ color: tone }}>{v}</span>
    </span>
  );
}

function TabLink({
  href,
  label,
  sub,
  active,
}: {
  href: string;
  label: string;
  sub: string;
  active: boolean;
}): ReactNode {
  return (
    <Link
      href={href}
      className="group relative flex flex-col justify-center rounded-t-md px-3 py-1.5 transition-colors"
      style={{
        backgroundColor: active ? 'rgba(56,189,248,0.08)' : 'transparent',
        borderTop: active ? '1px solid rgba(56,189,248,0.5)' : '1px solid transparent',
      }}
      aria-current={active ? 'page' : undefined}
    >
      <span
        className="font-mono text-mono-label uppercase tracking-wide"
        style={{ color: active ? '#38bdf8' : '#94a3b8' }}
      >
        {label} <span className="text-tertiary">{sub}</span>
      </span>
    </Link>
  );
}

/**
 * Shell aplikasi (kartu 🧩) — header + tab nav + footer identik antar tab,
 * konten view di bawahnya. Koneksi socket & store Zustand bersifat module-level
 * singleton, jadi pindah tab tidak mereset state (PRD AC).
 */
export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const pathname = usePathname();
  const active = tabKeyFor(pathname);

  // Overlay fixed (PerfOverlay, tombol Celebrate) menempel di dasar viewport;
  // ukur tinggi bar+footer → CSS var --shell-bottom-space agar overlay duduk
  // DI ATAS area command bar (tidak ketumpuk). Diukur ulang via ResizeObserver
  // (strip error bar menambah tinggi; breakpoint mobile menambah clearance dock).
  const bottomRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const measure = (): void => {
      const bar = bottomRef.current?.offsetHeight ?? 0;
      const footer = footerRef.current?.offsetHeight ?? 0;
      document.documentElement.style.setProperty('--shell-bottom-space', `${bar + footer}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (bottomRef.current) ro.observe(bottomRef.current);
    if (footerRef.current) ro.observe(footerRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas-base">
      {/* ── Header (identik antar tab) ── */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/8 bg-surface-container-low/80 px-4 py-2 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#4edea3] shadow-[0_0_8px_#4edea3]" />
            <span className="font-headline text-[15px] font-semibold tracking-tight text-[#f8fafc]">
              AUTO<span className="text-[#38bdf8]">OFFICE</span>3D
            </span>
          </span>
          <span className="hidden h-4 w-px bg-white/10 md:block" />
          <ConnectionBadge />
        </div>
        <HeaderStats />
      </header>

      {/* ── Tab nav (desktop: bar; mobile: dock bawah) ── */}
      <nav className="flex shrink-0 items-center gap-1 border-b border-white/8 bg-surface-container-low/50 px-2 backdrop-blur-sm">
        <div className="hidden gap-1 md:flex">
          {TABS.map((t) => (
            <TabLink
              key={t.key}
              href={t.href}
              label={t.label}
              sub={t.sub}
              active={active === t.key}
            />
          ))}
        </div>
        {/* Sinyal ringkas tab aktif di layar sempit */}
        <span className="font-mono text-mono-label uppercase tracking-wide text-[#38bdf8] md:hidden">
          {TABS.find((t) => t.key === active)?.label}
        </span>
      </nav>

      {/* ── Konten view (isi flex) ── */}
      <main className="relative min-h-0 flex-1">{children}</main>

      {/* ── Founder Command — PRD §3.1 (satu-satunya input manusia, semua tab) ── */}
      <div ref={bottomRef} className="shrink-0">
        <FounderCommandBar />
      </div>

      {/* ── Footer (identik antar tab) ── */}
      <footer
        ref={footerRef}
        className="flex shrink-0 items-center justify-between border-t border-white/8 bg-surface-container-low/60 px-4 py-1 font-mono text-label-xs uppercase tracking-widest text-tertiary backdrop-blur-sm"
      >
        <span>Founder Prompt ⇄ Brain · Autonomous Loop</span>
        <span className="hidden sm:inline">Milestone #1–#5</span>
      </footer>

      {/* ── Bottom dock tab (mobile <768px, DESIGN.md) ── */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex items-stretch justify-around border-t border-white/10 bg-surface-container-high/85 px-2 py-1 backdrop-blur-lg md:hidden">
        {TABS.map((t) => {
          const on = active === t.key;
          return (
            <Link
              key={t.key}
              href={t.href}
              className="flex flex-1 flex-col items-center gap-0.5 rounded py-1"
              style={{ color: on ? '#38bdf8' : '#94a3b8' }}
              aria-current={on ? 'page' : undefined}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: on ? '#38bdf8' : '#475569' }}
              />
              <span className="font-mono text-label-xs uppercase tracking-wide">
                {t.label.split(' ')[0]}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
