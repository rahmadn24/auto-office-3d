'use client';

import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MathUtils, Vector3, type Group, type Mesh, type MeshStandardMaterial } from 'three';

import { useOffice, type AgentRosterEntry, type AgentRuntime } from '@/store/officeStore';

/* Dimensi rig (unit scene) — permukaan pad zona = Y dasar agen. */
const HIP_STAND = 0.8;
const HIP_SIT = 0.61; // = tinggi duduk kursi di atas pad
const SHIN_STAND = 0.4;
const SHIN_SIT = 0.57; // kaki tergantung sampai lantai saat duduk

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt));
}

/** Billboard speech bubble: auto-hide setelah 6 detik, offset antar agen. */
function SpeechBubble({
  entry,
  offsetIndex,
}: {
  entry: AgentRosterEntry;
  offsetIndex: number;
}): ReactNode {
  const runtime = useOffice((s) => s.agents[entry.id]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (now - runtime.logAt > 6000 || runtime.log.length === 0) return null;

  // Offset vertikal bergantian (0.65) agar bubble agen berdekatan tidak tumpang tindih
  const height = 2.35 + (offsetIndex % 3) * 0.65;

  return (
    <Html position={[0, height, 0]} center zIndexRange={[30, 0]} className="pointer-events-none">
      <div className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-white/15 bg-surface-container-lowest/85 px-2 py-1 font-mono text-label-xs shadow-[0_0_16px_rgba(56,189,248,0.25)] backdrop-blur">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: entry.color }}
        />
        <span className="whitespace-nowrap text-on-surface-variant">{entry.name}</span>
        <span className="whitespace-nowrap text-on-surface">“{runtime.log}”</span>
      </div>
    </Html>
  );
}

/**
 * Rig bipedal low-poly (PRD §4.2): torso + rompi divisi, kepala ber-emissive,
 * lengan/kaki ber-pivot terpisah, digerakkan state matrix
 * IDLE / WORKING / WALKING / CELEBRATE dengan transisi teredam (tanpa snapping).
 */
export function BoxMan({
  entry,
  offsetIndex,
  onArrive,
}: {
  entry: AgentRosterEntry;
  offsetIndex: number;
  onArrive: () => void;
}): ReactNode {
  const runtime = useOffice((s) => s.agents[entry.id]);

  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const kneeL = useRef<Group>(null);
  const kneeR = useRef<Group>(null);
  const shinL = useRef<Mesh>(null);
  const shinR = useRef<Mesh>(null);
  const footL = useRef<Group>(null);
  const footR = useRef<Group>(null);
  const headMat = useRef<MeshStandardMaterial>(null);

  const sitBlend = useRef(1);
  const arrived = useRef(false);
  const targetVec = useVector();
  const dirVec = useVector();

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const t = state.clock.elapsedTime;
    const s: AgentRuntime['state'] = runtime.state;
    const rootG = root.current;
    const bodyG = body.current;
    if (!rootG || !bodyG) return;

    /* ── 1. Posisi & heading ───────────────────────────────────────── */
    const baseY = entry.home[1];
    const walking = s === 'WALKING' && runtime.target !== undefined;

    if (walking && runtime.target) {
      targetVec.set(runtime.target[0], runtime.target[1], runtime.target[2]);
      rootG.position.lerp(targetVec, 1 - Math.exp(-3.2 * dt));

      dirVec.subVectors(targetVec, rootG.position);
      if (dirVec.lengthSq() > 1e-4) {
        rootG.rotation.y = dampAngle(rootG.rotation.y, Math.atan2(dirVec.x, dirVec.z), 6, dt);
      }

      if (rootG.position.distanceTo(targetVec) < 0.12 && !arrived.current) {
        arrived.current = true;
        onArrive();
      }
    } else {
      arrived.current = false;
      // Saat merayakan di lingkaran hub, hadap ke hologram (0,0,0)
      const heading =
        s === 'CELEBRATE' ? Math.atan2(-rootG.position.x, -rootG.position.z) : entry.facing;
      rootG.rotation.y = dampAngle(rootG.rotation.y, heading, 6, dt);
    }

    // Efek vertikal per state
    let bob = 0;
    if (s === 'IDLE')
      bob = Math.sin(t * 2) * 0.03; // breathing ±0.03
    else if (s === 'WALKING') bob = Math.abs(Math.sin(t * 8)) * 0.04;
    else if (s === 'CELEBRATE') bob = Math.abs(Math.sin(t * 3.4)) * 1.4; // lompat +1.4
    rootG.position.y = baseY + bob;

    /* ── 2. Pose duduk / berdiri (teredam) ─────────────────────────── */
    const wantSit = s === 'IDLE' || s === 'WORKING' ? 1 : 0;
    sitBlend.current = MathUtils.damp(sitBlend.current, wantSit, 6, dt);
    const sit = sitBlend.current;
    const hipY = MathUtils.lerp(HIP_STAND, HIP_SIT, sit);
    const shinLen = MathUtils.lerp(SHIN_STAND, SHIN_SIT, sit);
    bodyG.position.y = hipY;

    const setShin = (shin: Mesh | null, foot: Group | null): void => {
      if (shin) {
        shin.scale.y = shinLen;
        shin.position.y = -shinLen / 2;
      }
      if (foot) foot.position.y = -shinLen;
    };
    setShin(shinL.current, footL.current);
    setShin(shinR.current, footR.current);

    /* ── 3. Kaki: stride saat WALKING, tekuk 90° saat duduk ────────── */
    const stride = s === 'WALKING' ? Math.sin(t * 7) * 0.55 : 0;
    const thighStandL = stride;
    const thighStandR = -stride;
    const kneeStand = s === 'WALKING' ? 0.25 + Math.max(0, Math.sin(t * 7 + 1)) * 0.35 : 0.06;

    const legTarget = (stand: number): number => MathUtils.lerp(stand, -Math.PI / 2, sit);
    const kneeTarget = MathUtils.lerp(kneeStand, Math.PI / 2, sit);

    if (legL.current)
      legL.current.rotation.x = dampTo(legL.current.rotation.x, legTarget(thighStandL), 12, dt);
    if (legR.current)
      legR.current.rotation.x = dampTo(legR.current.rotation.x, legTarget(thighStandR), 12, dt);
    if (kneeL.current)
      kneeL.current.rotation.x = dampTo(kneeL.current.rotation.x, kneeTarget, 12, dt);
    if (kneeR.current)
      kneeR.current.rotation.x = dampTo(kneeR.current.rotation.x, kneeTarget, 12, dt);

    /* ── 4. Lengan: mengetik / mengayun / merayakan ─────────────────── */
    let armX = 0;
    let armZ = 0;
    if (s === 'WORKING') {
      armX = -1.2 + Math.sin(t * 11) * 0.18; // ayunan mengetik
    } else if (s === 'WALKING') {
      armX = -stride * 0.8; // berlawanan dengan kaki
    } else if (s === 'CELEBRATE') {
      armX = -0.3;
      armZ = 2.5 + Math.sin(t * 8) * 0.3; // tangan terangkat
    } else {
      armX = Math.sin(t * 2) * 0.05;
    }

    if (armL.current) {
      armL.current.rotation.x = dampTo(armL.current.rotation.x, armX, 10, dt);
      armL.current.rotation.z = dampTo(armL.current.rotation.z, armZ, 10, dt);
    }
    if (armR.current) {
      armR.current.rotation.x = dampTo(armR.current.rotation.x, armX, 10, dt);
      armR.current.rotation.z = dampTo(armR.current.rotation.z, -armZ, 10, dt);
    }

    /* ── 5. Emisi kepala: denyut 8Hz saat WORKING ──────────────────── */
    let intensity = 0.6;
    if (s === 'WORKING') intensity = 1.6 + Math.sin(t * 2 * Math.PI * 8) * 0.9;
    else if (s === 'WALKING') intensity = 1 + Math.sin(t * 4) * 0.3;
    else if (s === 'CELEBRATE') intensity = 2.4 + Math.sin(t * 10) * 0.6;
    else if (s === 'IDLE') intensity = 0.6 + Math.sin(t * 2) * 0.15;

    if (headMat.current) {
      headMat.current.emissiveIntensity = dampTo(
        headMat.current.emissiveIntensity,
        intensity,
        8,
        dt,
      );
    }
  });

  return (
    <group ref={root} position={entry.home}>
      <group ref={body}>
        {/* Torso */}
        <mesh position={[0, 0.32, 0]} castShadow>
          <boxGeometry args={[0.68, 0.64, 0.38]} />
          <meshStandardMaterial color="#2b3a50" roughness={0.85} />
        </mesh>

        {/* Rompi warna divisi (sedikit berpendar agar terbaca di scene gelap) */}
        <mesh position={[0, 0.28, 0]} castShadow>
          <boxGeometry args={[0.72, 0.42, 0.42]} />
          <meshStandardMaterial
            color={entry.color}
            emissive={entry.color}
            emissiveIntensity={0.35}
            roughness={0.6}
          />
        </mesh>

        {/* Kepala ber-emissive (pendar naik saat berpikir/mengetik) */}
        <mesh position={[0, 0.91, 0]} castShadow>
          <boxGeometry args={[0.52, 0.52, 0.52]} />
          <meshStandardMaterial
            ref={headMat}
            color="#0d1626"
            emissive={entry.color}
            emissiveIntensity={0.6}
            roughness={0.35}
          />
        </mesh>

        {/* Visor */}
        <mesh position={[0, 0.93, 0.27]}>
          <boxGeometry args={[0.38, 0.1, 0.02]} />
          <meshBasicMaterial color="#dbe4f0" />
        </mesh>

        {/* Lengan (pivot bahu terpisah) */}
        <group ref={armL} position={[-0.42, 0.56, 0]}>
          <mesh position={[0, -0.28, 0]} castShadow>
            <boxGeometry args={[0.17, 0.56, 0.19]} />
            <meshStandardMaterial color="#334155" roughness={0.8} />
          </mesh>
        </group>
        <group ref={armR} position={[0.42, 0.56, 0]}>
          <mesh position={[0, -0.28, 0]} castShadow>
            <boxGeometry args={[0.17, 0.56, 0.19]} />
            <meshStandardMaterial color="#334155" roughness={0.8} />
          </mesh>
        </group>

        {/* Kaki: panggul + lutut ber-pivot terpisah */}
        <group ref={legL} position={[-0.19, 0, 0]}>
          <mesh position={[0, -0.2, 0]} castShadow>
            <boxGeometry args={[0.24, 0.4, 0.26]} />
            <meshStandardMaterial color="#334155" roughness={0.8} />
          </mesh>
          <group ref={kneeL} position={[0, -0.4, 0]}>
            <mesh ref={shinL} position={[0, -0.2, 0]} castShadow>
              <boxGeometry args={[0.2, 1, 0.22]} />
              <meshStandardMaterial color="#1e293b" roughness={0.8} />
            </mesh>
            <group ref={footL} position={[0, -0.4, 0]}>
              <mesh position={[0, -0.06, 0.06]} castShadow>
                <boxGeometry args={[0.24, 0.12, 0.34]} />
                <meshStandardMaterial color="#0f172a" roughness={0.9} />
              </mesh>
            </group>
          </group>
        </group>
        <group ref={legR} position={[0.19, 0, 0]}>
          <mesh position={[0, -0.2, 0]} castShadow>
            <boxGeometry args={[0.24, 0.4, 0.26]} />
            <meshStandardMaterial color="#334155" roughness={0.8} />
          </mesh>
          <group ref={kneeR} position={[0, -0.4, 0]}>
            <mesh ref={shinR} position={[0, -0.2, 0]} castShadow>
              <boxGeometry args={[0.2, 1, 0.22]} />
              <meshStandardMaterial color="#1e293b" roughness={0.8} />
            </mesh>
            <group ref={footR} position={[0, -0.4, 0]}>
              <mesh position={[0, -0.06, 0.06]} castShadow>
                <boxGeometry args={[0.24, 0.12, 0.34]} />
                <meshStandardMaterial color="#0f172a" roughness={0.9} />
              </mesh>
            </group>
          </group>
        </group>
      </group>

      <SpeechBubble entry={entry} offsetIndex={offsetIndex} />
    </group>
  );
}

function dampTo(current: number, target: number, lambda: number, dt: number): number {
  return MathUtils.damp(current, target, lambda, dt);
}

function useVector(): Vector3 {
  const ref = useRef<Vector3 | null>(null);
  if (ref.current === null) ref.current = new Vector3();
  return ref.current;
}
