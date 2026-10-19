'use client';

import { Html } from '@react-three/drei';
import { useEffect, useState, type ReactNode } from 'react';

import { zoneActivitySuffix, useBrain } from '@/store/brainStore';
import { ZONES, type Zone } from '@/lib/zones';

/**
 * Ticker lambat (2s) agar status basi bisa expired dari label zona.
 * Satu interval untuk seluruh matriks (dipanggil di `ZoneMatrix`), bukan
 * satu interval per platform zona — hemat timer (kartu bersih-bersih 13.4).
 */
function useStaleTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(id);
  }, [active]);
}

/** Platform satu zona: pad 0.4 tinggi + border glow aksen + label layar. */
function ZonePlatform({ zone, activity }: { zone: Zone; activity: string | null }): ReactNode {
  const [width, depth] = zone.size;
  const [x, y, z] = zone.position;

  return (
    <group position={[x, y, z]}>
      {/* Pad platform (permukaan atas di Y = 0.4, sesuai koordinat zona) */}
      <mesh position={[0, -0.2, 0]} receiveShadow>
        <boxGeometry args={[width, 0.4, depth]} />
        <meshPhongMaterial color="#091c33" specular={zone.accent} shininess={40} />
      </mesh>

      {/* Border glow wireframe aksen divisi */}
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[width + 0.3, 0.1, depth + 0.3]} />
        <meshBasicMaterial color={zone.accent} wireframe />
      </mesh>

      {/* Volume floor glow aksen divisi (paduan additive di atas permukaan pad) */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width + 1.6, depth + 1.6]} />
        <meshBasicMaterial
          color={zone.accent}
          transparent
          opacity={0.14}
          depthWrite={false}
          blending={2}
        />
      </mesh>

      {/* Label billboard di tepi selatan pad (di atas dada agen, tak menutupi kepala) */}
      <Html
        position={[0, 1.3, depth / 2 + 0.8]}
        center
        zIndexRange={[20, 0]}
        className="pointer-events-none"
      >
        <div className="whitespace-nowrap rounded border border-white/10 bg-surface-container-lowest/80 px-2 py-1 font-mono text-label-xs uppercase text-on-surface-variant backdrop-blur">
          <span
            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
            style={{ backgroundColor: zone.accent }}
          />
          {zone.label}
          {activity ? (
            <span className="ml-1.5 font-semibold" style={{ color: zone.accent }}>
              {activity}
            </span>
          ) : null}
        </div>
      </Html>
    </group>
  );
}

/** Enam zona PRD §4.1: 5 zona kantor + Central Neural Bus. */
export function ZoneMatrix(): ReactNode {
  const agents = useBrain((s) => s.agents);
  // Satu ticker agregat untuk semua zona (teks aktivitas expired tiap 2s).
  useStaleTick(Object.keys(agents).length > 0);
  return (
    <group>
      {ZONES.map((zone) => (
        <ZonePlatform
          key={zone.id}
          zone={zone}
          activity={zoneActivitySuffix(zone.key, agents, Date.now())}
        />
      ))}
    </group>
  );
}
