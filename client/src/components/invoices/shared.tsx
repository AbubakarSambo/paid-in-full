import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { InvoiceStatus, Num, RecurrenceInterval } from '@/types/invoicing'

/** Money in the UI: currency symbol, no decimals (spec §12). */
export function money(value: Num | null | undefined, currency = 'NGN') {
  const n = Math.round(Number(value ?? 0) || 0)
  const formatted = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format(n)
  return currency === 'NGN' ? `₦${formatted}` : `${currency} ${formatted}`
}

export const num = (v: Num | null | undefined) => Number(v ?? 0) || 0

export function fmtDate(v: string | Date | null | undefined) {
  if (!v) return '—'
  return new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(v))
}
export function fmtDateTime(v: string | Date | null | undefined) {
  if (!v) return '—'
  return new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(v),
  )
}
/** yyyy-mm-dd for <input type="date">. */
export function isoDay(v?: string | Date | null) {
  const d = v ? new Date(v) : new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10)
}

export const CADENCE_LABEL: Record<RecurrenceInterval, string> = {
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUALLY: 'Yearly',
}

export async function copyText(text: string, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(label)
  } catch {
    toast.error('Could not copy; select and copy manually')
  }
}

export function CopyButton({ text, label, className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-text-dim hover:text-gold', className)}
      onClick={async () => {
        await copyText(text, label ?? 'Copied')
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
      aria-label="Copy"
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

/** Uppercase micro-label chip (spec §12). */
export function Chip({ children, tone = 'dim', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
type Tone = 'dim' | 'green' | 'orange' | 'red' | 'blue' | 'purple' | 'gold'
const TONES: Record<Tone, string> = {
  dim: 'border-border text-text-dim bg-surface2',
  green: 'border-green/30 text-green bg-green/10',
  orange: 'border-orange/30 text-orange bg-orange/10',
  red: 'border-red/30 text-red bg-red/10',
  blue: 'border-blue/30 text-blue bg-blue/10',
  purple: 'border-purple/30 text-purple bg-purple/10',
  gold: 'border-gold/30 text-gold bg-gold/10',
}

const STATUS_TONE: Record<InvoiceStatus, Tone> = {
  DRAFT: 'dim',
  SENT: 'blue',
  PARTIALLY_PAID: 'orange',
  PAID: 'green',
  OVERDUE: 'red',
  VOID: 'dim',
}
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  PARTIALLY_PAID: 'Partial',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  VOID: 'Void',
}
export function StatusChip({ status, quote, expired }: { status: InvoiceStatus; quote?: boolean; expired?: boolean }) {
  if (quote && expired) return <Chip tone="red">Expired quote</Chip>
  return (
    <span className="inline-flex gap-1">
      {quote && <Chip tone="purple">Quote</Chip>}
      <Chip tone={STATUS_TONE[status]} className={status === 'VOID' ? 'line-through' : undefined}>
        {STATUS_LABEL[status]}
      </Chip>
    </span>
  )
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'red' | 'gold' }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-dim">{label}</div>
      <div
        className={cn(
          'mt-1 text-2xl font-bold tabular-nums',
          tone === 'green' && 'text-green',
          tone === 'red' && 'text-red',
          tone === 'gold' && 'text-gold',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-text-dim">{sub}</div>}
    </div>
  )
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">{label}</span>
      {children}
      {hint && <span className="block text-xs text-text-muted">{hint}</span>}
    </label>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm', disabled && 'cursor-not-allowed opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-gold' : 'bg-surface3')}
      >
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {label}
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  className?: string
}) {
  return (
    <div className={cn('inline-flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
            value === o.value ? 'bg-gold text-primary-foreground' : 'text-text-dim hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Centred modal card with ✕ and a footer row (Cancel / primary at the bottom right). */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg' | 'xl' | 'full'
}) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          'relative z-50 flex max-h-[94vh] w-full flex-col rounded-2xl border border-border bg-card shadow-2xl',
          size === 'md' && 'max-w-lg',
          size === 'lg' && 'max-w-2xl',
          size === 'xl' && 'max-w-4xl',
          size === 'full' && 'max-w-6xl h-[94vh]',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold leading-tight">{title}</h3>
            {description && <p className="mt-1 text-sm text-text-dim">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-text-dim hover:bg-secondary hover:text-foreground" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      Cancel
    </Button>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-text-dim">{children}</div>
}

/** Settings section wrapper used by the invoicing settings sections. */
export function SettingsCard({
  title,
  description,
  children,
  action,
}: {
  title: string
  description?: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          {description && <p className="mt-1 text-sm text-text-dim">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function ReadOnlyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-border bg-surface2 px-3 py-2 text-xs text-text-dim">{children}</p>
}

export const optNum = (v: string) => (v.trim() === '' ? undefined : Number(v))
export const optStr = (v: string) => (v.trim() === '' ? undefined : v.trim())
export const newRequestId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
