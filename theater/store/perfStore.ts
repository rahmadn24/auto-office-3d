import { create } from 'zustand';

/**
 * Metrik rendering untuk overlay dev (AC kartu Performance:
 * "Draw call & FPS overlay terlihat di dev mode, target 60.0").
 * Diisi oleh `<PerfProbe />` di dalam Canvas setiap 500ms.
 */
export interface PerfState {
  /** Frame per detik (rata-rata jendela 500ms). */
  fps: number;
  /** `renderer.info.render.calls` — draw call per frame. */
  drawCalls: number;
  /** `renderer.info.render.triangles` — segitiga per frame. */
  triangles: number;
}

export const usePerf = create<PerfState>(() => ({
  fps: 0,
  drawCalls: 0,
  triangles: 0,
}));
