'use client';

import { Canvas } from '@react-three/fiber';
import type { ReactNode } from 'react';

import { CAMERA_PRESET, CANVAS_THEME } from '@/lib/zones';

import { Floor } from './Floor';
import { NeuralBus } from './NeuralBus';
import { ZoneFurniture } from './Furniture';
import { ZoneMatrix } from './ZoneMatrix';
import { Agents } from './agents/Agents';
import { CameraRig } from './CameraRig';
import { Confetti } from './Confetti';
import { DemoDirector } from './DemoDirector';

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
    >
      <color attach="background" args={[CANVAS_THEME.background]} />
      <fogExp2 attach="fog" args={[CANVAS_THEME.fogColor, CANVAS_THEME.fogDensity]} />

      {/* Pencahayaan (referensi visual: code.html) */}
      <ambientLight color="#7388a5" intensity={1.2} />
      <directionalLight
        castShadow
        color="#60a5fa"
        intensity={2}
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
      <pointLight color="#22d3ee" intensity={3.5} distance={45} position={[-12, 10, -10]} />
      <pointLight color="#a855f7" intensity={3.5} distance={45} position={[12, 8, 12]} />
      <pointLight color="#f59e0b" intensity={3} distance={40} position={[10, 8, -12]} />

      <Floor />
      <ZoneMatrix />
      <ZoneFurniture />
      <NeuralBus />
      <Agents />
      <Confetti />
      <DemoDirector />

      <CameraRig />
    </Canvas>
  );
}
