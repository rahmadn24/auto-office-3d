/** Format ringkas angka telemetry (mirror brain `formatTokens`). */
export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(1)}k`;
}

/** Format dolar dari jumlah (mis. 29 → "$29.00"). */
export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}
