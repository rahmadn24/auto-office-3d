import type { ReactNode } from 'react';

import { ZONE_BY_KEY } from '@/lib/zones';

/** Meja kerja + monitor + keyboard (low-poly). */
function Desk({
  position,
  rotation = 0,
  screen = '#22d3ee',
}: {
  position: readonly [number, number, number];
  rotation?: number;
  screen?: string;
}): ReactNode {
  const legs: ReadonlyArray<readonly [number, number]> = [
    [-1.6, -0.7],
    [1.6, -0.7],
    [-1.6, 0.7],
    [1.6, 0.7],
  ];

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Table top */}
      <mesh position={[0, 1.6, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.6, 0.2, 1.8]} />
        <meshPhongMaterial color="#0f2744" />
      </mesh>

      {/* Legs */}
      {legs.map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, 0.8, z]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 1.6, 8]} />
          <meshPhongMaterial color="#334155" />
        </mesh>
      ))}

      {/* Monitor stand + screen */}
      <mesh position={[0, 1.95, -0.45]}>
        <boxGeometry args={[0.14, 0.5, 0.14]} />
        <meshPhongMaterial color="#334155" />
      </mesh>
      <mesh position={[0, 2.5, -0.5]} castShadow>
        <boxGeometry args={[1.7, 1, 0.08]} />
        <meshPhongMaterial color="#0b1626" />
      </mesh>
      <mesh position={[0, 2.5, -0.44]}>
        <planeGeometry args={[1.5, 0.82]} />
        <meshBasicMaterial color={screen} />
      </mesh>

      {/* Keyboard */}
      <mesh position={[0, 1.72, 0.45]}>
        <boxGeometry args={[1.3, 0.06, 0.45]} />
        <meshPhongMaterial color="#1e293b" />
      </mesh>
    </group>
  );
}

/** Kursi kantor: punggung di -Z, penghuni menghadap +Z. */
function Chair({
  position,
  rotation = 0,
}: {
  position: readonly [number, number, number];
  rotation?: number;
}): ReactNode {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.9, 0.12, 0.9]} />
        <meshPhongMaterial color="#1e293b" />
      </mesh>
      <mesh position={[0, 1.0, -0.4]} castShadow>
        <boxGeometry args={[0.9, 0.9, 0.12]} />
        <meshPhongMaterial color="#1e293b" />
      </mesh>
      <mesh position={[0, 0.27, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 0.55, 8]} />
        <meshPhongMaterial color="#334155" />
      </mesh>
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <cylinderGeometry args={[0.4, 0.4, 0.08, 12]} />
        <meshPhongMaterial color="#334155" />
      </mesh>
    </group>
  );
}

/** Meja bundar Strategy Room (PRD §4.3 preset Meeting). */
function RoundTable({ accent }: { accent: string }): ReactNode {
  const seats: ReadonlyArray<readonly [number, number]> = [
    [0, 2.7],
    [0, -2.7],
    [2.7, 0],
    [-2.7, 0],
  ];

  return (
    <group>
      <mesh position={[0, 1.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.7, 1.7, 0.18, 24]} />
        <meshPhongMaterial color="#0f2744" specular={accent} shininess={40} />
      </mesh>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.16, 0.24, 1.2, 12]} />
        <meshPhongMaterial color="#334155" />
      </mesh>
      {seats.map(([x, z]) => (
        <Chair key={`${x}:${z}`} position={[x, 0, z]} rotation={Math.atan2(-x, -z)} />
      ))}
    </group>
  );
}

/** Rak server DevOps: chassis + LED status berpendar. */
function ServerRack({
  position,
  rotation = 0,
  accent,
}: {
  position: readonly [number, number, number];
  rotation?: number;
  accent: string;
}): ReactNode {
  const leds = [0.45, 0.8, 1.15, 1.5, 1.85, 2.2];

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 1.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 2.6, 1.1]} />
        <meshPhongMaterial color="#0b1626" specular={accent} shininess={30} />
      </mesh>
      {leds.map((y, i) => (
        <mesh key={y} position={[0, y, 0.57]}>
          <boxGeometry args={[1.3, 0.1, 0.03]} />
          <meshBasicMaterial color={i % 2 === 0 ? accent : '#f59e0b'} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Prop per zona — AC kartu Zone Matrix: meja/kursi/rak low-poly
 * diletakkan di atas pad zona masing-masing (permukaan Y = 0.4).
 */
export function ZoneFurniture(): ReactNode {
  const founder = ZONE_BY_KEY.founder_desk.position;
  const meeting = ZONE_BY_KEY.meeting_room.position;
  const devLab = ZONE_BY_KEY.dev_lab.position;
  const marketing = ZONE_BY_KEY.marketing_studio.position;
  const devops = ZONE_BY_KEY.devops_hub.position;

  return (
    <group>
      {/* zone_01 · Founder Desk */}
      <group position={[founder[0], founder[1], founder[2]]}>
        <Desk position={[0, 0, -2]} screen="#818cf8" />
        <Chair position={[0, 0, 0.4]} rotation={Math.PI} />
      </group>

      {/* zone_02 · Strategy / Meeting Room */}
      <group position={[meeting[0], meeting[1], meeting[2]]}>
        <RoundTable accent="#f59e0b" />
      </group>

      {/* zone_03 · Core Dev & QA Lab */}
      <group position={[devLab[0], devLab[1], devLab[2]]}>
        <Desk position={[-3.6, 0, -2.6]} screen="#34d399" />
        <Chair position={[-3.6, 0, -0.2]} rotation={Math.PI} />
        <Desk position={[3.6, 0, -2.6]} screen="#22d3ee" />
        <Chair position={[3.6, 0, -0.2]} rotation={Math.PI} />
        <Desk position={[0, 0, 3]} screen="#34d399" rotation={Math.PI} />
        <Chair position={[0, 0, 0.6]} />
      </group>

      {/* zone_04 · Creative & Marketing Studio */}
      <group position={[marketing[0], marketing[1], marketing[2]]}>
        <Desk position={[-3.2, 0, -2.4]} screen="#f472b6" />
        <Chair position={[-3.2, 0, 0]} rotation={Math.PI} />
        <Desk position={[3.2, 0, -2.4]} screen="#a855f7" />
        <Chair position={[3.2, 0, 0]} rotation={Math.PI} />
      </group>

      {/* zone_05 · DevOps & Cloud Hub */}
      <group position={[devops[0], devops[1], devops[2]]}>
        <ServerRack position={[-2.3, 0, -1.6]} rotation={Math.PI / 2} accent="#06b6d4" />
        <ServerRack position={[2.3, 0, -1.6]} rotation={Math.PI / 2} accent="#22d3ee" />
        <Desk position={[0, 0, 2.2]} screen="#38bdf8" />
        <Chair position={[0, 0, 3.7]} rotation={Math.PI} />
      </group>
    </group>
  );
}
