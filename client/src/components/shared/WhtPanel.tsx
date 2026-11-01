import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { whtApi } from '@/lib/api/spend'
import { formatNaira, formatRatePct } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { MicroChip } from './Popover'

export interface WhtComputed {
  rate: number
  gross: number
  wht: number
  net: number
  /** True when the user overrode the resolved rate. */
  override: boolean
  /** Source label, e.g. "Vendor-level override", "Workspace default for Rent", "Manual override". */
  label: string
}

/** Spec §6 maths: gross = round(total), wht = round(gross × rate), net = max(0, gross − wht). */
export function computeWht(total: number, rate: number) {
  const gross = Math.round(total || 0)
  const wht = Math.round(gross * rate)
  return { gross, wht, net: Math.max(0, gross - wht) }
}

const QUICK = [
  { label: 'Provisions (goods) · 2%', rate: 0.02 },
  { label: 'Professional services · 5%', rate: 0.05 },
]

/**
 * WHT panel: resolves the rate via POST /wht/resolve (vendor + COA), shows rate / WHT / net and the source label,
 * quick chips (2% / 5%) and an "Override rate" checkbox.
 * Props: vendorId?, coa? (COA tag name), total, overrideRate (null = use resolved), onOverrideChange(rate|null),
 * onChange?(computed) fires whenever the effective figures change, disabled?, compact?.
 */
export function WhtPanel({
  vendorId,
  coa,
  total,
  overrideRate,
  onOverrideChange,
  onChange,
  disabled,
  compact,
}: {
  vendorId?: string | null
  coa?: string | null
  total: number
  overrideRate: number | null
  onOverrideChange: (rate: number | null) => void
  onChange?: (v: WhtComputed) => void
  disabled?: boolean
  compact?: boolean
}) {
  const { data: resolved, isFetching } = useQuery({
    queryKey: ['wht', 'resolve', vendorId ?? null, coa ?? null],
    queryFn: () => whtApi.resolve({ vendorId: vendorId || undefined, coa: coa || undefined }),
    staleTime: 30_000,
  })
  const override = overrideRate !== null
  const rate = override ? overrideRate : resolved?.rate ?? 0
  const label = override ? 'Manual override' : resolved?.label ?? 'No WHT applies'
  const { gross, wht, net } = computeWht(total, rate)
  const [pct, setPct] = useState(override ? String(Math.round(overrideRate * 10000) / 100) : '')

  const cb = useRef(onChange)
  cb.current = onChange
  useEffect(() => {
    cb.current?.({ rate, gross, wht, net, override, label })
  }, [rate, gross, wht, net, override, label])

  useEffect(() => {
    if (overrideRate !== null) setPct(String(Math.round(overrideRate * 10000) / 100))
  }, [overrideRate])

  return (
    <div className={cn('rounded-xl border border-border bg-secondary/40', compact ? 'p-2' : 'p-3')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Withholding tax</span>
        <div className="flex flex-wrap gap-1">
          {QUICK.map((q) => (
            <button
              key={q.rate}
              type="button"
              disabled={disabled}
              onClick={() => onOverrideChange(q.rate)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px]',
                override && overrideRate === q.rate ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-dim hover:border-gold hover:text-gold',
              )}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 text-sm">
        {rate === 0 ? (
          <span className="text-text-dim">No withholding tax applied</span>
        ) : (
          <div className="grid grid-cols-3 gap-2 tabular-nums">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-dim">Rate</div>
              <div className="font-semibold">{formatRatePct(rate)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-dim">WHT</div>
              <div className="font-semibold text-orange">{formatNaira(wht)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-dim">Net to vendor</div>
              <div className="font-semibold text-green">{formatNaira(net)}</div>
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <MicroChip className="text-text-dim">{isFetching && !override ? 'Resolving…' : label}</MicroChip>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            disabled={disabled}
            checked={override}
            onChange={(e) => onOverrideChange(e.target.checked ? resolved?.rate ?? 0 : null)}
          />
          Override rate
        </label>
        {override && (
          <div className="flex w-28 items-center gap-1">
            <Input
              value={pct}
              disabled={disabled}
              inputMode="decimal"
              className="h-8 px-2 text-xs"
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, '')
                setPct(v)
                const n = Number(v)
                if (v !== '' && Number.isFinite(n) && n >= 0 && n <= 100) onOverrideChange(n / 100)
              }}
            />
            <span className="text-xs text-text-dim">%</span>
          </div>
        )}
      </div>
    </div>
  )
}
