'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import { Color, DoubleSide, MathUtils, Object3D, type InstancedMesh } from 'three';

import { useOffice } from '@/store/officeStore';

const COUNT = 140;
const RING_RADIUS = 9;
const FALL_HEIGHT = 9;
const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#38bdf8', '#ffffff'];

interface Piece {
  angle: number;
  radius: number;
  fall: number;
  offset: number;
  spin: number;
}

/**
 * Partikel konfeti di sekitar hub_00 — aktif selama ada agen berstate
 * CELEBRATE (AC kartu State Matrix + Celebration FX).
 */
export function Confetti(): ReactNode {
  const active = useOffice((s) => s.celebrating);
  const mesh = useRef<InstancedMesh>(null);
  const vis = useRef(0);
  const colored = useRef(false);

  const dummy = useMemo(() => new Object3D(), []);
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: COUNT }, (_, i) => ({
        angle: (i / COUNT) * Math.PI * 2 + Math.random() * 0.4,
        radius: 1.2 + Math.random() * RING_RADIUS,
        fall: 0.6 + Math.random() * 0.9,
        offset: Math.random() * FALL_HEIGHT * 4,
        spin: 2 + Math.random() * 5,
      })),
    [],
  );
  const colors = useMemo(() => PALETTE.map((hex) => new Color(hex)), []);

  useFrame((state, delta) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(delta, 0.1);

    vis.current = MathUtils.damp(vis.current, active ? 1 : 0, 4, dt);

    if (!colored.current) {
      // Warna per-instance untuk SEMUA piece (sebelumnya hanya 6 pertama).
      for (let i = 0; i < pieces.length; i += 1) {
        m.setColorAt(i, colors[i % colors.length]!);
      }
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      colored.current = true;
    }

    const t = state.clock.elapsedTime;
    const visible = vis.current > 0.01;
    if (!visible && !active) {
      // Nonaktif penuh → skip 140 updateMatrix + upload instanceMatrix tiap frame.
      m.visible = false;
      return;
    }

    for (let i = 0; i < pieces.length; i += 1) {
      const p = pieces[i];
      if (!p) continue;
      const cycle = (t * p.fall * 2 + p.offset) % FALL_HEIGHT;
      const y = 0.4 + (visible ? FALL_HEIGHT - cycle : 0);
      dummy.position.set(
        Math.cos(p.angle) * p.radius + Math.sin(t * 0.9 + p.offset) * 0.5,
        y,
        Math.sin(p.angle) * p.radius + Math.cos(t * 0.7 + p.offset) * 0.5,
      );
      dummy.rotation.set(t * p.spin, t * p.spin * 0.7, 0);
      const scale = 0.16 * vis.current;
      dummy.scale.set(scale, scale * 1.5, scale);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    m.visible = vis.current > 0.01;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial side={DoubleSide} transparent opacity={0.95} depthWrite={false} />
    </instancedMesh>
  );
}
