import { useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { PageMeta, WalletHealthStatus } from '@/types/wallet'

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          toast.error('Copy failed — select the text instead')
        }
      }}
      className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-dim hover:border-gold hover:text-gold"
      aria-label={`${label} ${value}`}
    >
      {done ? <Check size={12} /> : <Copy size={12} />} {done ? 'Copied' : label}
    </button>
  )
}

const HEALTH: Record<WalletHealthStatus, string> = {
  HEALTHY: 'bg-green/15 text-green border-green/30',
  ATTENTION: 'bg-orange/15 text-orange border-orange/30',
  ACTION_NEEDED: 'bg-red/15 text-red border-red/30',
}

export function HealthBadge({ status, label }: { status: WalletHealthStatus; label: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider', HEALTH[status])}>
      {label}
    </span>
  )
}

export function Pager({ meta, onPage }: { meta?: PageMeta; onPage: (p: number) => void }) {
  if (!meta || meta.totalPages <= 1) return null
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-xs text-text-dim">
      <span>
        Page {meta.page} of {meta.totalPages} · {meta.total} entries
      </span>
      <button className="rounded-lg border border-border p-1 disabled:opacity-40" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page">
        <ChevronLeft size={14} />
      </button>
      <button className="rounded-lg border border-border p-1 disabled:opacity-40" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)} aria-label="Next page">
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

/** "Message us on WhatsApp" link. Number from VITE_SUPPORT_WHATSAPP (digits, intl format); falls back to the picker. */
export function supportWhatsappUrl(text: string) {
  const phone = String(import.meta.env.VITE_SUPPORT_WHATSAPP ?? '').replace(/\D/g, '')
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}
