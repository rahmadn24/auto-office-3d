'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

import type { AgentStatusPayload } from '@/lib/events';
import { ZONES } from '@/lib/zones';
import { AGENT_ROSTER } from '@/store/officeStore';
import { useBrain } from '@/store/brainStore';

/**
 * Jaring aman viewport 3D. Chromium/GPU tanpa WebGL melempar error saat
 * `<Canvas>` membuat renderer; tanpa boundary, error itu menjatuhkan seluruh
 * route dan header stat ikut kosong. Fallback 2D tetap menampilkan zona &
 * status agen live supaya operator bisa memantau run.
 */
function SceneFallback(): ReactNode {
  const agents = useBrain((s) => s.agents);
  const runStage = useBrain((s) => s.runStage);

  const agentsByZone = new Map<string, AgentStatusPayload[]>();
  for (const a of Object.values(agents)) {
    if (!a) continue;
    const list = agentsByZone.get(a.targetZone) ?? [];
    list.push(a);
    agentsByZone.set(a.targetZone, list);
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas-base px-4 pb-20 pt-4 md:pl-[96px] md:pr-6 md:pb-6 xl:pl-[328px] xl:pr-8 xl:pb-8">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(rgba(56,189,248,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.12) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div className="relative flex h-full flex-col gap-3">
        <div className="rounded-xl border border-[#f59e0b]/30 bg-[#f59e0b]/8 px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#f59e0b]">
            3D viewport unavailable
          </div>
          <div className="mt-1 font-headline text-[15px] font-semibold text-[#f8fafc]">
            WebGL tidak aktif — mode 2D tetap live
          </div>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[#94a3b8]">
            Browser ini tidak bisa membuat konteks WebGL. Semua event Brain, chat PM, dan status
            agen tetap berjalan; aktifkan hardware acceleration lalu reload untuk kembali ke Office
            Theater 3D.
          </p>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
          {ZONES.map((zone) => {
            const zoneAgents = agentsByZone.get(zone.key) ?? [];
            return (
              <section
                key={zone.key}
                className="flex min-h-[112px] flex-col rounded-xl border bg-black/20 p-3"
                style={{
                  borderColor: `${zone.accent}55`,
                  boxShadow: `inset 0 0 24px ${zone.accent}12`,
                }}
              >
                <header className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-wide text-[#94a3b8]">
                    {zone.label}
                  </span>
                  <span
                    className="rounded px-1 font-mono text-[8px] uppercase tracking-wide"
                    style={{ backgroundColor: `${zone.accent}22`, color: zone.accent }}
                  >
                    {zone.division}
                  </span>
                </header>
                <div className="mt-2 flex flex-1 flex-col gap-1">
                  {zoneAgents.length === 0 ? (
                    <span className="font-mono text-[10px] text-[#475569]">idle</span>
                  ) : (
                    zoneAgents.map((a) => (
                      <div
                        key={a.agentId}
                        className="flex items-center justify-between gap-2 rounded border border-white/6 bg-surface-container-low/60 px-2 py-1"
                      >
                        <span className="truncate font-mono text-[10px] uppercase tracking-wide text-[#f8fafc]">
                          {AGENT_ROSTER.find((r) => r.id === a.agentId)?.name ?? a.agentId}
                        </span>
                        <span
                          className="shrink-0 font-mono text-[9px] uppercase tracking-wide"
                          style={{ color: zone.accent }}
                        >
                          {a.currentAction}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-[#94a3b8]">
          stage <span className="text-[#38bdf8]">{runStage ?? '—'}</span>
          <span className="mx-2 text-[#475569]">·</span>
          {Object.keys(agents).length} agen tersinkron
        </div>
      </div>
    </div>
  );
}

interface SceneBoundaryState {
  failed: boolean;
}

export class SceneBoundary extends Component<{ children: ReactNode }, SceneBoundaryState> {
  override state: SceneBoundaryState = { failed: false };

  static getDerivedStateFromError(): SceneBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[theater] 3D viewport gagal — fallback 2D aktif', error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? <SceneFallback /> : this.props.children;
  }
}
