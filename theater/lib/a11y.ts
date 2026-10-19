/**
 * Helper aksesibilitas murni (Fase 13) — diuji tanpa DOM.
 */

/**
 * Indeks fokus baru untuk navigasi tab (`role`-less link bar) dengan
 * ArrowLeft/ArrowRight/Home/End. `current` = -1 bila belum ada fokus.
 * Return null bila tombol bukan tombol navigasi (biarkan perilaku default).
 */
export function nextTabIndex(current: number, length: number, key: string): number | null {
  if (length <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return current < 0 ? 0 : (current + 1) % length;
    case 'ArrowLeft':
      return current < 0 ? length - 1 : (current - 1 + length) % length;
    case 'Home':
      return 0;
    case 'End':
      return length - 1;
    default:
      return null;
  }
}
