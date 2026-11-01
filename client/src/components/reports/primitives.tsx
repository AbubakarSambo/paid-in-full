import type { ReactNode } from 'react'
import { BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { naira } from './format'

export function MicroLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('text-[10px] font-semibold uppercase tracking-[0.12em] text-text-dim', className)}>{children}</span>
  )
}

export function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-8 shrink-0 rounded-full border px-3 text-[11px] font-semibold uppercase tracking-wider transition-colors',
        active
          ? 'border-gold bg-gold/15 text-gold'
          : 'border-border bg-transparent text-text-dim hover:border-gold/50 hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function KpiTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'gold' | 'green' | 'orange' }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <MicroLabel>{label}</MicroLabel>
      <div
        className={cn(
          'mt-2 font-display text-xl font-bold tabular-nums sm:text-2xl',
          tone === 'gold' && 'text-gold',
          tone === 'green' && 'text-green',
          tone === 'orange' && 'text-orange',
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-text-dim">{sub}</div> : null}
    </div>
  )
}

export function Panel({
  title,
  meta,
  actions,
  children,
  className,
}: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('min-w-0 rounded-2xl border border-border bg-card', className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 pb-2 pt-4 sm:px-5">
        <div className="min-w-0">
          <h3 className="font-display text-sm font-semibold">{title}</h3>
          {meta ? <div className="mt-0.5 text-xs text-text-dim">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className="px-4 pb-4 sm:px-5">{children}</div>
    </section>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-surface2', className)} />
}

export function KpiSkeletonRow({ count }: { count: number }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3', count >= 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[88px] rounded-2xl" />
      ))}
    </div>
  )
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="text-text-muted">{icon ?? <BarChart3 className="h-6 w-6" />}</div>
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-text-dim">{hint}</p> : null}
    </div>
  )
}

/** Horizontal scroll lives inside the card, never on the page. */
export function TableScroll({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('-mx-4 overflow-x-auto sm:-mx-5', className)}>
      <div className="inline-block min-w-full px-4 align-middle sm:px-5">{children}</div>
    </div>
  )
}

export const th = 'whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-text-dim first:pl-0 last:pr-0'
export const thNum = cn(th, 'text-right')
export const td = 'whitespace-nowrap px-3 py-2 first:pl-0 last:pr-0'
export const tdNum = cn(td, 'text-right tabular-nums')

export function Swatch({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} aria-hidden />
}

/** Recharts tooltip body; values in text tokens, colour only on the swatch. */
export function ChartTooltip({
  active,
  label,
  rows,
  total,
}: {
  active?: boolean
  label?: ReactNode
  rows: { name: string; value: number; color: string }[]
  total?: number
}) {
  if (!active || rows.length === 0) return null
  return (
    <div className="min-w-[180px] rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      {label ? <div className="mb-1.5 font-semibold text-foreground">{label}</div> : null}
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-2 text-text-dim">
              <Swatch color={r.color} />
              <span className="truncate">{r.name}</span>
            </span>
            <span className="tabular-nums text-foreground">{naira(r.value)}</span>
          </div>
        ))}
      </div>
      {total !== undefined ? (
        <div className="mt-1.5 flex justify-between border-t border-border pt-1.5 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{naira(total)}</span>
        </div>
      ) : null}
    </div>
  )
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-text-dim">
      {items.map((i) => (
        <span key={i.name} className="flex items-center gap-1.5">
          <Swatch color={i.color} />
          {i.name}
        </span>
      ))}
    </div>
  )
}

/** Shared axis styling: recessive ticks, no axis lines. */
export const axisTick = { fill: 'var(--text-dim)', fontSize: 11 }
export const gridStroke = 'var(--border)'

/** Status chip: uppercase micro-label; colour reinforces, the label carries the meaning. */
export function StatusPill({ status }: { status: string }) {
  const s = status.toUpperCase()
  const tone =
    /SUCCESS|PAID|COMPLETE|SYNCED|MATCHED/.test(s) && !/PARTIAL|UNPAID/.test(s)
      ? 'bg-green/15 text-green'
      : /FAIL|REVERS|ERROR|MISMATCH|OVERDUE|VOID|CANCEL/.test(s)
        ? 'bg-red/15 text-red'
        : /PARTIAL|PROCESS|PENDING|FIXABLE|AWAIT/.test(s)
          ? 'bg-orange/15 text-orange'
          : /SENT|QUEUE/.test(s)
            ? 'bg-blue/15 text-blue'
            : 'bg-surface3 text-text-dim'
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider', tone)}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}
