import { describe, expect, it } from 'vitest';

import {
  CAMERA_PRESET,
  CANVAS_THEME,
  GRID_SIZE,
  ORBIT_LIMITS,
  ZONES,
  ZONE_BY_KEY,
  type ZoneKey,
} from '../lib/zones';

/**
 * Kontrak Zone Matrix — PRD §4.1 (matriks koordinat zona) & §4.3 (kamera).
 * Duplikasi kontrak dari brain/ diizinkan; yang penting nilainya identik.
 */
describe('zone matrix PRD §4.1', () => {
  it('memuat 6 zona: zone_01…zone_05 + hub_00', () => {
    expect(ZONES).toHaveLength(6);
    expect(ZONES.map((z) => z.id)).toEqual([
      'zone_01',
      'zone_02',
      'zone_03',
      'zone_04',
      'zone_05',
      'hub_00',
    ]);
  });

  it('koordinat (X, Y, Z) identik dengan tabel PRD §4.1', () => {
    const expected: Record<ZoneKey, readonly [number, number, number]> = {
      founder_desk: [-14, 0.4, 14],
      meeting_room: [-13, 0.4, -13],
      dev_lab: [14, 0.4, -12],
      marketing_studio: [14, 0.4, 12],
      devops_hub: [0, 0.4, 16],
      central_bus: [0, 0.4, 0],
    };
    for (const zone of ZONES) {
      expect(zone.position).toEqual(expected[zone.key]);
    }
  });

  it('dimensi (W × D) & aksen warna sesuai PRD §4.1', () => {
    const expected: Record<ZoneKey, { size: readonly [number, number]; accent: string }> = {
      founder_desk: { size: [10, 10], accent: '#6366f1' },
      meeting_room: { size: [12, 11], accent: '#f59e0b' },
      dev_lab: { size: [14, 12], accent: '#10b981' },
      marketing_studio: { size: [12, 11], accent: '#ec4899' },
      devops_hub: { size: [8, 8], accent: '#06b6d4' },
      central_bus: { size: [8, 8], accent: '#38bdf8' },
    };
    for (const zone of ZONES) {
      expect(zone.size).toEqual(expected[zone.key].size);
      expect(zone.accent).toBe(expected[zone.key].accent);
      expect(zone.label.length).toBeGreaterThan(0);
      expect(zone.division.length).toBeGreaterThan(0);
    }
  });

  it('ZONE_BY_KEY memetakan kunci targetZone Brain ke zona PRD', () => {
    expect(Object.keys(ZONE_BY_KEY).sort()).toEqual(
      [
        'central_bus',
        'dev_lab',
        'devops_hub',
        'founder_desk',
        'marketing_studio',
        'meeting_room',
      ].sort(),
    );
    expect(ZONE_BY_KEY.central_bus.id).toBe('hub_00');
  });

  it('semua zona berada di dalam grid 60×60 (origin di pusat)', () => {
    const bound = GRID_SIZE / 2;
    for (const zone of ZONES) {
      const [w, d] = zone.size;
      const [x, , z] = zone.position;
      expect(Math.abs(x) + w / 2).toBeLessThanOrEqual(bound);
      expect(Math.abs(z) + d / 2).toBeLessThanOrEqual(bound);
    }
  });
});

describe('viewport kamera & atmosfer (PRD §4.3)', () => {
  it('kamera default isometrik Position(38, 30, 42) → origin, FOV 40°', () => {
    expect(CAMERA_PRESET.overview.position).toEqual([38, 30, 42]);
    expect(CAMERA_PRESET.overview.target).toEqual([0, 0, 0]);
    expect(CAMERA_PRESET.overview.fov).toBe(40);
  });

  it('batas polar orbit 0.2 → π/2.2', () => {
    expect(ORBIT_LIMITS.minPolarAngle).toBeCloseTo(0.2);
    expect(ORBIT_LIMITS.maxPolarAngle).toBeCloseTo(Math.PI / 2.2);
    expect(ORBIT_LIMITS.minDistance).toBeLessThan(ORBIT_LIMITS.maxDistance);
  });

  it('atmosfer gelap sesuai DESIGN.md (canvas base #0c0f17 / surface #051424)', () => {
    expect(CANVAS_THEME.background).toBe('#051424');
    expect(CANVAS_THEME.fogDensity).toBeCloseTo(0.018);
    expect(GRID_SIZE).toBe(60);
  });
});
