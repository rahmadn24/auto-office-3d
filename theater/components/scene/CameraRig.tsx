'use client';

import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, type ReactNode } from 'react';
import { Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

import { CAMERA_RIG_PRESETS } from '@/lib/camera';
import { useReducedMotion } from '@/lib/motion';
import { ORBIT_LIMITS } from '@/lib/zones';
import { useOffice } from '@/store/officeStore';

const pos = new Vector3();
const tgt = new Vector3();

/**
 * Kamera rig — PRD §4.3: 5 preset cinematic + orbit bebas.
 * Transisi preset memakai lerp eksponensial (halus); interaksi pengguna
 * otomatis memindah preset ke `orbit` supaya tidak melawan drag mouse.
 */
export function CameraRig(): ReactNode {
  const preset = useOffice((s) => s.cameraPreset);
  const setPreset = useOffice((s) => s.setCameraPreset);
  const reduced = useReducedMotion();
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();

  useEffect(() => {
    const impl = controls.current;
    if (!impl) return undefined;
    const onUserStart = (): void => setPreset('orbit');
    impl.addEventListener('start', onUserStart);
    return (): void => {
      impl.removeEventListener('start', onUserStart);
    };
  }, [setPreset]);

  const desired = preset === 'orbit' ? undefined : CAMERA_RIG_PRESETS[preset];

  useFrame((_, delta) => {
    const impl = controls.current;
    if (!impl || !desired) return;
    // Reduced motion: lompat langsung ke pose preset (tanpa transisi lerp).
    const k = reduced ? 1 : 1 - Math.exp(-3 * Math.min(delta, 0.1));
    camera.position.lerp(pos.set(...desired.position), k);
    impl.target.lerp(tgt.set(...desired.target), k);
    impl.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={!reduced}
      dampingFactor={0.08}
      minPolarAngle={ORBIT_LIMITS.minPolarAngle}
      maxPolarAngle={ORBIT_LIMITS.maxPolarAngle}
      minDistance={ORBIT_LIMITS.minDistance}
      maxDistance={ORBIT_LIMITS.maxDistance}
    />
  );
}
