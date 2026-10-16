'use client';

import { useFrame } from '@react-three/fiber';
import { useRef, type ReactNode } from 'react';
import type { Group, Mesh } from 'three';

/** Hologram router di origin (0,0,0): dua ring berputar + inti oktahedron berdenyut. */
export function NeuralBus(): ReactNode {
  const group = useRef<Group>(null);
  const ringA = useRef<Mesh>(null);
  const ringB = useRef<Mesh>(null);
  const core = useRef<Mesh>(null);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (ringA.current) ringA.current.rotation.z += delta * 0.4;
    if (ringB.current) {
      ringB.current.rotation.x += delta * 0.28;
      ringB.current.rotation.y += delta * 0.16;
    }
    if (core.current) {
      core.current.rotation.y += delta * 0.6;
      const pulse = 1 + Math.sin(t * 2) * 0.08;
      core.current.scale.setScalar(pulse);
    }
    if (group.current) group.current.position.y = 2.5 + Math.sin(t * 1.2) * 0.06;
  });

  return (
    <group ref={group} position={[0, 2.5, 0]}>
      <mesh ref={ringA} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.2, 0.05, 12, 48]} />
        <meshBasicMaterial color="#22d3ee" wireframe />
      </mesh>
      <mesh ref={ringB}>
        <torusGeometry args={[2.2, 0.05, 12, 48]} />
        <meshBasicMaterial color="#818cf8" wireframe />
      </mesh>
      <mesh ref={core}>
        <octahedronGeometry args={[0.9, 0]} />
        <meshBasicMaterial color="#38bdf8" wireframe />
      </mesh>
      <pointLight color="#22d3ee" intensity={8} distance={24} />
    </group>
  );
}
