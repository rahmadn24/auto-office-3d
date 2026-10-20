'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, type ReactNode } from 'react';
import type { PerspectiveCamera } from 'three';

import { CAMERA_PRESET, CANVAS_THEME } from '@/lib/zones';
import { useOffice } from '@/store/officeStore';
import { useBrain } from '@/store/brainStore';

import { Floor } from './Floor';
import { NeuralBus } from './NeuralBus';
import { ZoneFurniture } from './Furniture';
import { ZoneMatrix } from './ZoneMatrix';
import { Agents } from './agents/Agents';
import { CameraRig } from './CameraRig';
import { Confetti } from './Confetti';
import { DemoDirector } from './DemoDirector';
import { PerfProbe } from './PerfProbe';

/**
 * Komposisi 3D di 1280–1799 px: panel divisi 280 px menutupi zona Founder.
 * Geser frustum 180 px ke kanan (diturunkan bertahap menjelang 1800 px) agar
 * seluruh zona tetap terbaca tanpa mengubah canvas full-bleed. Di ≥1800 px
 * feed kanan terbuka; offset dimatikan supaya scene tidak bertabrakan.
 */
function SceneViewOffset(): null {
  const { camera, size } = useThree();

  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    if (typeof cam.setViewOffset !== 'function') return undefined;
    const shift =
      size.width < 1280
        ? 0
        : size.width < 1600
          ? 180
          : size.width < 1800
            ? Math.round((180 * (1800 - size.width)) / 200)
            : 0;
    if (shift === 0) cam.clearViewOffset();
    else cam.setViewOffset(size.width, size.height, -shift, 0, size.width, size.height);
    cam.updateProjectionMatrix();
    return (): void => {
      cam.clearViewOffset();
      cam.updateProjectionMatrix();
    };
  }, [camera, size.width, size.height]);

  return null;
}

/**
 * Viewport 3D isometrik — PRD §4.1 & §4.3:
 * grid 60×60, fog atmosferik, pencahayaan neon per-arah,
 * kamera default Position(38, 30, 42) / FOV 40° dengan orbit damping.
 */
export default function OfficeScene(): ReactNode {
  const overview = CAMERA_PRESET.overview;
  const position: [number, number, number] = [
    overview.position[0],
    overview.position[1],
    overview.position[2],
  ];

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position, fov: overview.fov, near: 0.1, far: 1000 }}
      gl={{ antialias: true, alpha: true }}
      onCreated={(state) => {
        // Eksposur naik 25% — scene PRD bergelap (#051424) tapi objek harus tetap terbaca
        state.gl.toneMappingExposure = 1.25;
        if (process.env.NODE_ENV === 'development') {
          // Hook debug dev-only: dipakai verifikasi browser (scene graph & store)
          (window as unknown as Record<string, unknown>).__office = {
            scene: state.scene,
            store: useOffice,
            brain: useBrain,
          };
        }
      }}
    >
      <color attach="background" args={[CANVAS_THEME.background]} />
      <fogExp2 attach="fog" args={[CANVAS_THEME.fogColor, CANVAS_THEME.fogDensity]} />

      {/* Pencahayaan (referensi visual: code.html) + eksposur agar scene terbaca */}
      <ambientLight color="#7388a5" intensity={1.7} />
      <directionalLight
        castShadow
        color="#60a5fa"
        intensity={2.6}
        position={[25, 45, 20]}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.5}
        shadow-camera-far={120}
        shadow-camera-left={-35}
        shadow-camera-right={35}
        shadow-camera-top={35}
        shadow-camera-bottom={-35}
      />
      <pointLight color="#22d3ee" intensity={5} distance={45} position={[-12, 10, -10]} />
      <pointLight color="#a855f7" intensity={5} distance={45} position={[12, 8, 12]} />
      <pointLight color="#f59e0b" intensity={4} distance={40} position={[10, 8, -12]} />

      <Floor />
      <ZoneMatrix />
      <ZoneFurniture />
      <NeuralBus />
      <Agents />
      <Confetti />
      <DemoDirector />
      <PerfProbe />

      <SceneViewOffset />
      <CameraRig />
    </Canvas>
  );
}
