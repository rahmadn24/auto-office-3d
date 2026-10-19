/** Format ringkas angka telemetry (mirror brain `formatTokens`). */
export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(1)}k`;
}

/** Format dolar dari jumlah (mis. 29 → "$29.00"). */
export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Format nominal lintas mata uang (mirror `brain/src/types.ts`) — IDR `Rp 290.000`. */
export function formatMoney(amount: number, currency: string): string {
  return currency === 'IDR'
    ? `Rp ${Math.round(amount).toLocaleString('id-ID')}`
    : `$${amount.toFixed(2)}`;
}
