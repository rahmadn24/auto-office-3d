/**
 * Token visual DESIGN.md (Elevation & Depth):
 * glass = #131826 @ 70% + backdrop-blur 16px + micro-line border rgba(255,255,255,0.08).
 * Dipakai oleh seluruh panel HUD (inkonsistensi glass = AC 📱 gagal).
 */
export const GLASS = 'border border-white/8 bg-[rgba(19,24,38,0.7)] backdrop-blur-[16px]';

/** Glass lebih pekat (overlay/inspector yang menutupi kanvas). */
export const GLASS_STRONG = 'border border-white/8 bg-[rgba(19,24,38,0.88)] backdrop-blur-[16px]';

/** Gutter desktop (1.5rem) & margin desktop (2rem) dari DESIGN.md. */
export const GUTTER_DESKTOP = 24;
export const MARGIN_DESKTOP = 32;
