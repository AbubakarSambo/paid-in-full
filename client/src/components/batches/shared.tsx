import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { toNumber } from '@/lib/money'
import { apiErrorMessage } from '@/lib/api/batches'
import type { BatchItemPayoutStatus, BatchLine, BatchPayoutStatus } from '@/types/batches'

/** Whole-naira display (spec §12). */
export const naira = (v: unknown) =>
  `₦${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format(Math.round(toNumber(v)))}`

/** Exact amount (keeps kobo) — used where the payer must type the figure exactly. */
export const nairaExact = (v: unknown) =>
  `₦${new Intl.NumberFormat('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(toNumber(v))}`

export const kobo = (v: number) => Math.round(v * 100)

/** Parses "₦1,234.50" / "1234.5" → 1234.5; NaN when not a valid amount. */
export function parseAmount(s: string): number {
  const cleaned = s.replace(/[₦,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return NaN
  return Number(cleaned)
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d))
}

export function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d))
}

const BATCH_STATUS: Record<BatchPayoutStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Awaiting', cls: 'bg-blue/15 text-blue border-blue/30' },
  PROCESSING: { label: 'In flight', cls: 'bg-purple/15 text-purple border-purple/30' },
  PARTIAL: { label: 'Partial', cls: 'bg-orange/15 text-orange border-orange/30' },
  SUCCESS: { label: 'Paid', cls: 'bg-green/15 text-green border-green/30' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-surface3 text-text-dim border-border' },
}

export function BatchStatusPill({ status }: { status: BatchPayoutStatus }) {
  const s = BATCH_STATUS[status] ?? BATCH_STATUS.PENDING
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', s.cls)}>
      {s.label}
    </span>
  )
}

const LINE_STATUS: Record<BatchItemPayoutStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Pending', cls: 'bg-blue/15 text-blue border-blue/30' },
  SENDING: { label: 'Sending', cls: 'bg-purple/15 text-purple border-purple/30' },
  SUCCESS: { label: 'Paid', cls: 'bg-green/15 text-green border-green/30' },
  FAILED: { label: 'Failed', cls: 'bg-red/15 text-red border-red/30' },
  REVERSED: { label: 'Reversed', cls: 'bg-red/15 text-red border-red/30' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-surface3 text-text-dim border-border' },
  SKIPPED: { label: 'Skipped', cls: 'bg-orange/15 text-orange border-orange/30' },
}

export function LineStatusPill({ line }: { line: Pick<BatchLine, 'payoutStatus' | 'isPaid' | 'paid'> }) {
  let s = LINE_STATUS[line.payoutStatus] ?? LINE_STATUS.PENDING
  if (line.isPaid && line.payoutStatus !== 'CANCELLED') s = LINE_STATUS.SUCCESS
  else if (line.payoutStatus === 'PENDING' && line.paid > 0) s = { label: 'Part paid', cls: 'bg-orange/15 text-orange border-orange/30' }
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', s.cls)}>
      {s.label}
    </span>
  )
}

export function MicroLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[10px] font-semibold uppercase tracking-[0.12em] text-text-dim', className)}>{children}</p>
}

/** Runs an async action with a toast on failure; returns the result or undefined. */
export async function withToast<T>(fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> {
  try {
    const r = await fn()
    if (success) toast.success(typeof success === 'function' ? success(r) : success)
    return r
  } catch (err) {
    toast.error(await apiErrorMessage(err))
    return undefined
  }
}

/**
 * Centred modal card with ✕ (spec §12). `locked` hides ✕ and ignores backdrop/Escape — used while
 * money is moving so the window cannot be dismissed by accident.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  locked,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  locked?: boolean
  className?: string
}) {
  useEffect(() => {
    if (!open || locked) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, locked, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={locked ? undefined : onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-50 flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold leading-tight text-foreground">{title}</h3>
            {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
          </div>
          {!locked && (
            <button
              onClick={onClose}
              className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-all hover:bg-secondary hover:text-foreground"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** Single-field prompt (cancel reason, rename). */
export function PromptDialog({
  open,
  onClose,
  title,
  description,
  label,
  initial = '',
  placeholder,
  required,
  confirmText = 'Save',
  danger,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  label: string
  initial?: string
  placeholder?: string
  required?: boolean
  confirmText?: string
  danger?: boolean
  onSubmit: (value: string) => Promise<unknown>
}) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setValue(initial)
  }, [open, initial])
  const submit = async () => {
    setBusy(true)
    try {
      await onSubmit(value.trim())
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={danger ? 'destructive' : 'default'}
            isLoading={busy}
            disabled={required && !value.trim()}
            onClick={submit}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="space-y-1.5">
        <Label required={required}>{label}</Label>
        <Input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (!required || value.trim()) && !busy && submit()}
        />
      </div>
    </Sheet>
  )
}
