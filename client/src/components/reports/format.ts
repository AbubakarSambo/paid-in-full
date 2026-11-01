import type { NamedTotal, PayCategoryLite } from '@/types/reports'

/** ₦ with no decimals (spec §12). */
export function naira(n: number | null | undefined): string {
  const v = Math.round(Number(n) || 0)
  return `${v < 0 ? '−' : ''}₦${Math.abs(v).toLocaleString('en-NG')}`
}

/** Compact ₦ for chart axes only (₦1.2M). Exact values live in tooltips and tables. */
export function nairaShort(n: number): string {
  return `₦${new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.round(n) || 0)}`
}

export function pct(share: number): string {
  const p = (Number(share) || 0) * 100
  return `${p < 10 && p > 0 ? p.toFixed(1) : Math.round(p)}%`
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-NG', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

export function shortDate(d: string | null | undefined): string {
  if (!d) return '—'
  const date = new Date(d.length === 10 ? `${d}T00:00:00Z` : d)
  if (Number.isNaN(date.getTime())) return d
  return date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Pull a readable message out of an axios error (including blob error bodies from export endpoints). */
export async function errorMessage(err: unknown, fallback = 'Something went wrong'): Promise<string> {
  const data = (err as { response?: { data?: unknown } })?.response?.data
  let body: unknown = data
  if (data instanceof Blob) {
    try {
      body = JSON.parse(await data.text())
    } catch {
      return fallback
    }
  }
  const msg = (body as { message?: unknown })?.message
  if (Array.isArray(msg)) return msg.join(', ')
  if (typeof msg === 'string' && msg) return msg
  return (err as Error)?.message || fallback
}

export function errorMessageSync(err: unknown, fallback = 'Something went wrong'): string {
  const msg = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(', ')
  if (typeof msg === 'string' && msg) return msg
  return fallback
}

/**
 * Fallback categorical order (dark-surface steps of the validated reference palette), used only when a
 * pay category has no colour of its own. Assigned by the category's position in the report (largest
 * first), never cycled: past eight, categories fall back to a neutral.
 */
const FALLBACK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
export const NEUTRAL = '#8a8475'

/** Single-series accents. */
export const SERIES_PRIMARY = '#F4B942' // gold (brand accent)
export const SERIES_SECONDARY = '#3987e5' // blue

export function buildCategoryColors(
  categories: Pick<NamedTotal, 'label' | 'color'>[],
  payCategories: PayCategoryLite[] | undefined,
): (label: string) => string {
  const fromPc = new Map((payCategories ?? []).filter((c) => c.color).map((c) => [c.name.toLowerCase(), c.color as string]))
  const map = new Map<string, string>()
  let fallbackIdx = 0
  for (const c of categories) {
    const color = c.color || fromPc.get(c.label.toLowerCase())
    if (color) map.set(c.label, color)
    else map.set(c.label, FALLBACK[fallbackIdx++] ?? NEUTRAL)
  }
  return (label: string) => map.get(label) ?? fromPc.get(label.toLowerCase()) ?? NEUTRAL
}
