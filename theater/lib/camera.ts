import type { CameraPresetKey } from '@/store/officeStore';

type Vec3 = readonly [number, number, number];

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

/**
 * 5 preset cinematic (PRD §4.3) — `orbit` sengaja tidak ada di sini
 * karena artinya kamera bebas (tanpa auto-lerp).
 */
export const CAMERA_RIG_PRESETS: Record<Exclude<CameraPresetKey, 'orbit'>, CameraPose> = {
  overview: { position: [38, 30, 42], target: [0, 0, 0] },
  founder: { position: [-2, 10, 30], target: [-14, 1.6, 14] },
  devLab: { position: [30, 13, 4], target: [14, 1.6, -12] },
  meeting: { position: [0, 12, -2], target: [-13, 1.6, -13] },
  devOps: { position: [14, 11, 32], target: [0, 1.6, 16] },
};

export const CAMERA_PRESET_LABELS: Record<CameraPresetKey, string> = {
  overview: 'Overview',
  founder: 'Founder',
  devLab: 'Dev Lab',
  meeting: 'Meeting',
  devOps: 'DevOps',
  orbit: 'Orbit',
};
