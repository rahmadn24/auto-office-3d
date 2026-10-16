import { Instance, Instances } from '@react-three/drei';
import type { ReactNode } from 'react';
import { DoubleSide } from 'three';

import { ZONE_BY_KEY } from '@/lib/zones';

/** Offset lokal diputar ke world (rotasi sumbu Y). */
function placed(
  zone: readonly [number, number, number],
  offset: readonly [number, number, number],
  rot: number,
): [number, number, number] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [
    zone[0] + offset[0] * c + offset[2] * s,
    zone[1] + offset[1],
    zone[2] - offset[0] * s + offset[2] * c,
  ];
}

/* ── Data statis: posisi furnitur (dihitung sekali, zero runtime cost) ───── */

const founder = ZONE_BY_KEY.founder_desk.position;
const meeting = ZONE_BY_KEY.meeting_room.position;
const devLab = ZONE_BY_KEY.dev_lab.position;
const marketing = ZONE_BY_KEY.marketing_studio.position;
const devops = ZONE_BY_KEY.devops_hub.position;

/** Kursi: [dunia, rotY] — meja RoundTable & spot agen ikut daftar ini. */
const CHAIR_SPOTS: readonly {
  readonly zone: readonly [number, number, number];
  readonly local: readonly [number, number, number];
  readonly rot: number;
}[] = [
  // zone_01 Founder
  { zone: founder, local: [0, 0, 0.4], rot: Math.PI },
  // zone_02 Meeting — 4 kursi mengelilingi meja bundar
  { zone: meeting, local: [0, 0, 2.7], rot: Math.atan2(0, -2.7) },
  { zone: meeting, local: [0, 0, -2.7], rot: Math.atan2(0, 2.7) },
  { zone: meeting, local: [2.7, 0, 0], rot: Math.atan2(-2.7, 0) },
  { zone: meeting, local: [-2.7, 0, 0], rot: Math.atan2(2.7, 0) },
  // zone_03 Dev Lab — 3 kursi
  { zone: devLab, local: [-3.6, 0, -0.2], rot: Math.PI },
  { zone: devLab, local: [3.6, 0, -0.2], rot: Math.PI },
  { zone: devLab, local: [0, 0, 0.6], rot: 0 },
  // zone_04 Marketing — 2 kursi
  { zone: marketing, local: [-3.2, 0, 0], rot: Math.PI },
  { zone: marketing, local: [3.2, 0, 0], rot: Math.PI },
  // zone_05 DevOps — 1 kursi
  { zone: devops, local: [0, 0, 3.7], rot: Math.PI },
];

/** Meja: [dunia, rotY] — 4 kaki tiap meja di-instance. */
const DESK_SPOTS: readonly {
  readonly zone: readonly [number, number, number];
  readonly local: readonly [number, number, number];
  readonly rot: number;
}[] = [
  { zone: founder, local: [0, 0, -2], rot: 0 },
  { zone: devLab, local: [-3.6, 0, -2.6], rot: 0 },
  { zone: devLab, local: [3.6, 0, -2.6], rot: 0 },
  { zone: devLab, local: [0, 0, 3], rot: Math.PI },
  { zone: marketing, local: [-3.2, 0, -2.4], rot: 0 },
  { zone: marketing, local: [3.2, 0, -2.4], rot: 0 },
  { zone: devops, local: [0, 0, 2.2], rot: 0 },
];

const RACK_SPOTS: readonly {
  readonly zone: readonly [number, number, number];
  readonly local: readonly [number, number, number];
  readonly rot: number;
}[] = [
  { zone: devops, local: [-2.3, 0, -1.6], rot: Math.PI / 2 },
  { zone: devops, local: [2.3, 0, -1.6], rot: Math.PI / 2 },
];

function worldOf(spot: {
  zone: readonly [number, number, number];
  local: readonly [number, number, number];
}): [number, number, number] {
  return [spot.zone[0] + spot.local[0], spot.zone[1] + spot.local[1], spot.zone[2] + spot.local[2]];
}

const chaisePart = (
  offset: readonly [number, number, number],
): readonly { pos: [number, number, number]; rot: number }[] =>
  CHAIR_SPOTS.map((spot) => {
    const w = worldOf(spot);
    return { pos: placed(w, offset, spot.rot), rot: spot.rot };
  });

const SEATS = chaisePart([0, 0.55, 0]);
const BACKS = chaisePart([0, 1.0, -0.4]);
const POLES = chaisePart([0, 0.27, 0]);
const BASES = chaisePart([0, 0.04, 0]);

const LEG_OFFSETS: readonly (readonly [number, number, number])[] = [
  [-1.6, 0.8, -0.7],
  [1.6, 0.8, -0.7],
  [-1.6, 0.8, 0.7],
  [1.6, 0.8, 0.7],
];
const DESK_LEGS = DESK_SPOTS.flatMap((spot) => {
  const w = worldOf(spot);
  return LEG_OFFSETS.map((o) => ({ pos: placed(w, o, spot.rot), rot: spot.rot }));
});

const DESK_TOPS = DESK_SPOTS.map((spot) => ({
  pos: placed(worldOf(spot), [0, 1.6, 0], spot.rot),
  rot: spot.rot,
}));
const MONITOR_STANDS = DESK_SPOTS.map((spot) => ({
  pos: placed(worldOf(spot), [0, 1.95, -0.45], spot.rot),
  rot: spot.rot,
}));
const MONITORS = DESK_SPOTS.map((spot) => ({
  pos: placed(worldOf(spot), [0, 2.5, -0.5], spot.rot),
  rot: spot.rot,
}));
const SCREENS = DESK_SPOTS.map((spot) => ({
  pos: placed(worldOf(spot), [0, 2.5, -0.44], spot.rot),
  rot: spot.rot,
}));
const KEYBOARDS = DESK_SPOTS.map((spot) => ({
  pos: placed(worldOf(spot), [0, 1.72, 0.45], spot.rot),
  rot: spot.rot,
}));

const RACK_BODIES = RACK_SPOTS.map((spot) => ({ pos: worldOf(spot), rot: spot.rot }));
const LED_OFFSETS = [0.45, 0.8, 1.15, 1.5, 1.85, 2.2];
const RACK_LEDS_A: { pos: [number, number, number]; rot: number }[] = [];
const RACK_LEDS_B: { pos: [number, number, number]; rot: number }[] = [];
for (const spot of RACK_SPOTS) {
  const w = worldOf(spot);
  LED_OFFSETS.forEach((y, i) => {
    const pos = placed(w, [0, y, 0.57], spot.rot);
    (i % 2 === 0 ? RACK_LEDS_A : RACK_LEDS_B).push({ pos, rot: spot.rot });
  });
}

/* ── Komponen ────────────────────────────────────────────────────────────── */

function InstanceSet({
  geometry,
  material,
  items,
}: {
  /** JSX geometri, mis. <boxGeometry args={[...]} /> */
  geometry: ReactNode;
  /** JSX material */
  material: ReactNode;
  items: readonly { pos: readonly [number, number, number]; rot: number }[];
}): ReactNode {
  return (
    <Instances limit={Math.max(items.length, 1)} castShadow receiveShadow>
      {geometry}
      {material}
      {items.map((item, i) => (
        <Instance key={i} position={item.pos} rotation={[0, item.rot, 0]} />
      ))}
    </Instances>
  );
}

/**
 * Prop zona low-poly (meja/kursi/rak) — semua objek berulang memakai
 * `<Instances>` dari drei (batching draw call, AC kartu Performance),
 * diletakkan tepat di atas pad zona masing-masing (permukaan Y = 0.4).
 */
export function ZoneFurniture(): ReactNode {
  return (
    <group>
      {/* Kursi (11 unit → 4 draw call) */}
      <InstanceSet
        geometry={<boxGeometry args={[0.9, 0.12, 0.9]} />}
        material={<meshStandardMaterial color="#1e293b" roughness={0.8} />}
        items={SEATS}
      />
      <InstanceSet
        geometry={<boxGeometry args={[0.9, 0.9, 0.12]} />}
        material={<meshStandardMaterial color="#1e293b" roughness={0.8} />}
        items={BACKS}
      />
      <InstanceSet
        geometry={<cylinderGeometry args={[0.07, 0.09, 0.55, 8]} />}
        material={<meshStandardMaterial color="#334155" roughness={0.8} />}
        items={POLES}
      />
      <InstanceSet
        geometry={<cylinderGeometry args={[0.4, 0.4, 0.08, 12]} />}
        material={<meshStandardMaterial color="#334155" roughness={0.8} />}
        items={BASES}
      />

      {/* Meja (7 unit → kaki/top/monitor ter-instance) */}
      <InstanceSet
        geometry={<cylinderGeometry args={[0.08, 0.08, 1.6, 8]} />}
        material={<meshStandardMaterial color="#334155" roughness={0.8} />}
        items={DESK_LEGS}
      />
      <InstanceSet
        geometry={<boxGeometry args={[3.6, 0.2, 1.8]} />}
        material={<meshStandardMaterial color="#0f2744" roughness={0.7} />}
        items={DESK_TOPS}
      />
      <InstanceSet
        geometry={<boxGeometry args={[0.14, 0.5, 0.14]} />}
        material={<meshStandardMaterial color="#334155" roughness={0.8} />}
        items={MONITOR_STANDS}
      />
      <InstanceSet
        geometry={<boxGeometry args={[1.7, 1, 0.08]} />}
        material={<meshStandardMaterial color="#0b1626" roughness={0.5} />}
        items={MONITORS}
      />
      <InstanceSet
        geometry={<planeGeometry args={[1.5, 0.82]} />}
        material={<meshBasicMaterial color="#22d3ee" side={DoubleSide} />}
        items={SCREENS}
      />
      <InstanceSet
        geometry={<boxGeometry args={[1.3, 0.06, 0.45]} />}
        material={<meshPhongMaterial color="#1e293b" />}
        items={KEYBOARDS}
      />

      {/* Rak server DevOps (chassis + LED berpendar) */}
      <InstanceSet
        geometry={<boxGeometry args={[1.7, 2.6, 1.1]} />}
        material={<meshPhongMaterial color="#0b1626" specular="#06b6d4" shininess={30} />}
        items={RACK_BODIES}
      />
      <InstanceSet
        geometry={<boxGeometry args={[1.3, 0.1, 0.03]} />}
        material={<meshBasicMaterial color="#06b6d4" />}
        items={RACK_LEDS_A}
      />
      <InstanceSet
        geometry={<boxGeometry args={[1.3, 0.1, 0.03]} />}
        material={<meshBasicMaterial color="#f59e0b" />}
        items={RACK_LEDS_B}
      />

      <RoundTable accent={ZONE_BY_KEY.meeting_room.accent} />
    </group>
  );
}

/** Meja bundar Strategy Room (kursinya sudah ter-instance di atas). */
function RoundTable({ accent }: { accent: string }): ReactNode {
  const [x, y, z] = meeting;
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 1.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.7, 1.7, 0.18, 24]} />
        <meshPhongMaterial color="#0f2744" specular={accent} shininess={40} />
      </mesh>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.16, 0.24, 1.2, 12]} />
        <meshPhongMaterial color="#334155" />
      </mesh>
    </group>
  );
}
