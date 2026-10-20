'use client';

import type { ReactNode } from 'react';

import { CAMERA_PRESET_LABELS, CAMERA_RIG_PRESETS } from '@/lib/camera';
import { useOffice, type CameraPresetKey } from '@/store/officeStore';

type RigPresetKey = Exclude<CameraPresetKey, 'orbit'>;

const PRESET_KEYS = Object.keys(CAMERA_RIG_PRESETS) as RigPresetKey[];

/**
 * Pemilih preset kamera cinematic (PRD §4.3 — 5 preset + orbit bebas).
 * Sebelumnya `meeting`/`devOps` tidak terjangkau dari UI (kartu bersih-bersih
 * 13.4) — picker ini membuat kelimanya dapat dipilih; drag kanvas tetap
 * memindah ke mode `orbit` seperti sebelumnya.
 */
export function CameraPresets(): ReactNode {
  const preset = useOffice((s) => s.cameraPreset);
  const setPreset = useOffice((s) => s.setCameraPreset);

  return (
    <div
      className="fixed left-1/2 z-40 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-surface-container-lowest/85 px-2 py-1 font-mono text-label-xs uppercase tracking-widest text-on-surface-variant backdrop-blur md:flex"
      // Di atas area footer (ukur dinamis di AppShell).
      style={{ bottom: 'calc(1.25rem + var(--shell-bottom-space, 0px))' }}
      role="group"
      aria-label="Preset kamera"
    >
      <span className="px-1 text-outline">cam</span>
      {PRESET_KEYS.map((key) => {
        const active = preset === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setPreset(key)}
            aria-pressed={active}
            title={`Preset kamera: ${CAMERA_PRESET_LABELS[key]}`}
            className="rounded-full px-2 py-0.5 transition-colors"
            style={{
              color: active ? '#38bdf8' : '#94a3b8',
              backgroundColor: active ? 'rgba(56,189,248,0.12)' : 'transparent',
            }}
          >
            {CAMERA_PRESET_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}
