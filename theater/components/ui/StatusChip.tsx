import type { ReactNode } from 'react';

/**
 * Chip status (AC 📱): label mono uppercase + dot pulse 6px (h-1.5 = 6px).
 * Satu sumber gaya chip untuk semua view HUD.
 */
export function StatusChip({
  label,
  color,
  pulse = true,
  title,
}: {
  label: string;
  color: string;
  pulse?: boolean;
  title?: string;
}): ReactNode {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide"
      style={{ backgroundColor: `${color}1a`, color, border: `1px solid ${color}40` }}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${pulse ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
