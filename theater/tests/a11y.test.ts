import { describe, expect, it } from 'vitest';

import { nextTabIndex } from '../lib/a11y';
import { readReducedMotion, REDUCED_MOTION_QUERY } from '../lib/motion';

describe('motion: prefers-reduced-motion (Fase 13 — aksesibilitas)', () => {
  it('media query sesuai standar', () => {
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
  });

  it('readReducedMotion menerima mock matchMedia (MediaQueryList)', () => {
    // Mock objek matchMedia — tidak butuh DOM/jsdom.
    const reducedMock = { matches: true, media: REDUCED_MOTION_QUERY } as MediaQueryList;
    const fullMock = { matches: false, media: REDUCED_MOTION_QUERY } as MediaQueryList;
    expect(readReducedMotion(reducedMock)).toBe(true);
    expect(readReducedMotion(fullMock)).toBe(false);
    expect(readReducedMotion(null)).toBe(false);
    expect(readReducedMotion(undefined)).toBe(false);
  });
});

describe('a11y: navigasi keyboard tab sidebar (Fase 13)', () => {
  it('ArrowRight/ArrowLeft berputar (wrap-around), Home/End melompat', () => {
    expect(nextTabIndex(0, 6, 'ArrowRight')).toBe(1);
    expect(nextTabIndex(5, 6, 'ArrowRight')).toBe(0);
    expect(nextTabIndex(0, 6, 'ArrowLeft')).toBe(5);
    expect(nextTabIndex(3, 6, 'ArrowLeft')).toBe(2);
    expect(nextTabIndex(4, 6, 'Home')).toBe(0);
    expect(nextTabIndex(1, 6, 'End')).toBe(5);
  });

  it('belum ada fokus aktif (-1): Arrow memilih ujung yang masuk akal', () => {
    expect(nextTabIndex(-1, 6, 'ArrowRight')).toBe(0);
    expect(nextTabIndex(-1, 6, 'ArrowLeft')).toBe(5);
  });

  it('tombol lain / daftar kosong tidak mencuri default browser', () => {
    expect(nextTabIndex(0, 6, 'ArrowUp')).toBeNull();
    expect(nextTabIndex(0, 6, 'Enter')).toBeNull();
    expect(nextTabIndex(0, 0, 'ArrowRight')).toBeNull();
  });
});
