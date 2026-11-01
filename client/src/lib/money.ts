/** Parse a number / Prisma Decimal string safely (NaN → 0). */
export function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
  return Number.isFinite(n) ? n : 0
}

/** ₦ with no decimals (spec: money is whole naira in the UI). */
export function formatNaira(v: unknown): string {
  return `₦${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format(Math.round(toNumber(v)))}`
}

/** A 0–1 rate as a percentage label, e.g. 0.05 → "5%", 0.075 → "7.5%". */
export function formatRatePct(rate: unknown): string {
  const pct = Math.round(toNumber(rate) * 10000) / 100
  return `${pct}%`
}
