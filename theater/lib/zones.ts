/**
 * Zone matrix — kontrak duplikat dari PRD §4.1 (theater/ boleh menduplikasi
 * kontrak brain/, asal tidak saling import).
 *
 * Grid isometrik 60×60 unit, origin (0,0,0) di pusat Neural Bus.
 */

export type ZoneKey =
  'founder_desk' | 'meeting_room' | 'dev_lab' | 'marketing_studio' | 'devops_hub' | 'central_bus';

export interface Zone {
  /** ID PRD: zone_01…zone_05, hub_00 */
  id: string;
  key: ZoneKey;
  label: string;
  /** Koordinat (X, Y, Z) sesuai PRD §4.1 */
  position: readonly [number, number, number];
  /** Dimensi (W × D) sesuai PRD §4.1 */
  size: readonly [number, number];
  /** Aksen warna PRD §4.1 (hex) */
  accent: string;
  /** Divisi penghuni */
  division: string;
}

export const ZONES: readonly Zone[] = [
  {
    id: 'zone_01',
    key: 'founder_desk',
    label: 'ZONE 01 // FOUNDER DESK',
    position: [-14, 0.4, 14],
    size: [10, 10],
    accent: '#6366f1',
    division: 'Founder',
  },
  {
    id: 'zone_02',
    key: 'meeting_room',
    label: 'ZONE 02 // STRATEGY ROOM',
    position: [-13, 0.4, -13],
    size: [12, 11],
    accent: '#f59e0b',
    division: 'Product',
  },
  {
    id: 'zone_03',
    key: 'dev_lab',
    label: 'ZONE 03 // CORE DEV & QA LAB',
    position: [14, 0.4, -12],
    size: [14, 12],
    accent: '#10b981',
    division: 'Engineering',
  },
  {
    id: 'zone_04',
    key: 'marketing_studio',
    label: 'ZONE 04 // CREATIVE & MARKETING STUDIO',
    position: [14, 0.4, 12],
    size: [12, 11],
    accent: '#ec4899',
    division: 'Growth',
  },
  {
    id: 'zone_05',
    key: 'devops_hub',
    label: 'ZONE 05 // DEVOPS & CLOUD HUB',
    position: [0, 0.4, 16],
    size: [8, 8],
    accent: '#06b6d4',
    division: 'DevOps',
  },
  {
    id: 'hub_00',
    key: 'central_bus',
    label: 'HUB 00 // CENTRAL NEURAL BUS',
    position: [0, 0.4, 0],
    size: [8, 8],
    accent: '#38bdf8',
    division: 'Core',
  },
] as const;

export const ZONE_BY_KEY: Readonly<Record<ZoneKey, Zone>> = Object.fromEntries(
  ZONES.map((z) => [z.key, z]),
) as Readonly<Record<ZoneKey, Zone>>;

/** Grid isometrik (PRD §4.1). */
export const GRID_SIZE = 60;

/** Kamera default isometrik (PRD §4.3). */
export const CAMERA_PRESET = {
  overview: {
    position: [38, 30, 42] as readonly [number, number, number],
    target: [0, 0, 0] as readonly [number, number, number],
    fov: 40,
  },
} as const;

/** Batas orbit (PRD §4.3): polar 0.2 → π/2.2. */
export const ORBIT_LIMITS = {
  minPolarAngle: 0.2,
  maxPolarAngle: Math.PI / 2.2,
  minDistance: 18,
  maxDistance: 95,
} as const;

/** Atmosfer kanvas (DESIGN.md — canvas base #0c0f17). */
export const CANVAS_THEME = {
  background: '#051424',
  fogColor: '#051424',
  fogDensity: 0.018,
  gridColorCenter: '#1e3a5f',
  gridColorCell: '#0c2138',
  floorColor: '#061527',
} as const;
