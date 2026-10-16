'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useRef, type ReactNode } from 'react';

import { usePerf } from '@/store/perfStore';

const WINDOW_MS = 500;

/**
 * Probe sampling: hitung FPS + baca `gl.info.render` tiap 500ms,
 * tulis ke `usePerf` (dikonsumsi PerfOverlay di layer DOM).
 */
export function PerfProbe(): ReactNode {
  const { gl } = useThree();
  const frames = useRef(0);
  const last = useRef(0);
  const primed = useRef(false);

  useFrame(() => {
    if (!primed.current) {
      primed.current = true;
      last.current = performance.now();
    }
    frames.current += 1;

    const now = performance.now();
    const elapsed = now - last.current;
    if (elapsed < WINDOW_MS) return;

    const info = gl.info.render;
    usePerf.setState({
      fps: Math.round(((frames.current * 1000) / elapsed) * 10) / 10,
      drawCalls: info.calls,
      triangles: info.triangles,
    });
    frames.current = 0;
    last.current = now;
  });

  return null;
}
