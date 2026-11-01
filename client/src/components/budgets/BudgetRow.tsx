import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatNaira } from '@/lib/money'
import type { BudgetOverviewRow } from '@/types/budgets'
import { Chip } from '@/components/queue/common'

export function ProgressRing({ pct, size = 44 }: { pct: number | null; size?: number }) {
  const stroke = 4
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  const color = pct === null ? 'var(--text-muted)' : pct > 100 ? 'var(--red)' : pct >= 80 ? 'var(--orange)' : 'var(--green)'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums">
        {pct === null ? '—' : `${Math.round(pct)}%`}
      </span>
    </div>
  )
}

export function BudgetRow({
  row,
  canEdit,
  editHint,
  onSave,
  onRemove,
  saving,
}: {
  row: BudgetOverviewRow
  canEdit: boolean
  editHint?: string
  onSave: (amount: number) => void
  onRemove: () => void
  saving?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const start = () => {
    setValue(row.cap !== null ? String(row.cap) : '')
    setEditing(true)
  }
  const save = () => {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) return
    onSave(Math.round(n))
    setEditing(false)
  }
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
      <ProgressRing pct={row.pct} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{row.name}</span>
          {row.over > 0 && <Chip tone="red">Over {formatNaira(row.over)}</Chip>}
          {row.cap === null && <Chip>No cap</Chip>}
        </div>
        <div className="mt-0.5 text-xs text-text-dim tabular-nums">
          Spent {formatNaira(row.spent)}
          {row.remaining !== null && (
            <>
              {' '}
              · Left <span className={row.remaining < 0 ? 'text-red' : ''}>{formatNaira(row.remaining)}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
        {editing ? (
          <>
            <input
              autoFocus
              type="number"
              min={0}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
                if (e.key === 'Escape') setEditing(false)
              }}
              placeholder="Monthly cap"
              className="h-8 w-32 rounded-md border border-input bg-card px-2 text-right text-sm tabular-nums focus:border-gold focus:outline-none"
            />
            <button className="rounded-md p-1.5 text-green hover:bg-green/10" onClick={save} aria-label="Save cap">
              <Check size={15} />
            </button>
            <button className="rounded-md p-1.5 text-text-dim hover:bg-surface2" onClick={() => setEditing(false)} aria-label="Cancel">
              <X size={15} />
            </button>
          </>
        ) : (
          <>
            <span className={cn('text-sm font-bold tabular-nums', row.cap === null && 'text-text-muted')}>
              {row.cap === null ? '—' : formatNaira(row.cap)}
            </span>
            {canEdit ? (
              <div className="flex items-center gap-1">
                <button className="rounded-md px-2 py-1 text-[11px] font-semibold text-gold hover:bg-gold/10 disabled:opacity-50" disabled={saving} onClick={start}>
                  {row.cap === null ? 'Set cap' : 'Edit monthly cap'}
                </button>
                {row.cap !== null && row.budgetId && (
                  <button className="rounded-md px-2 py-1 text-[11px] font-semibold text-text-dim hover:text-red disabled:opacity-50" disabled={saving} onClick={onRemove}>
                    Remove cap
                  </button>
                )}
              </div>
            ) : (
              editHint && <span className="text-[10px] text-text-muted">{editHint}</span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
