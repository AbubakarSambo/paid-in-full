import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Card wrapper for the SHELL settings sections. */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-2xl border border-border bg-card p-5', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          {description && <div className="mt-0.5 text-sm text-text-dim">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function ReadOnly({ role = 'Admin' }: { role?: string }) {
  return <p className="mb-3 rounded-lg bg-secondary px-3 py-2 text-xs text-text-dim">Read-only — {role} role required to edit</p>
}

export function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-0 first:pt-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {hint && <p className="text-xs text-text-dim">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Stat({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface2 p-3', className)}>
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">{label}</p>
      <div className="mt-1 font-display text-lg font-bold tabular-nums text-foreground">{value}</div>
    </div>
  )
}

/** YYYY-MM-DD (spec locale for tables). */
export const ymd = (d?: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—')
