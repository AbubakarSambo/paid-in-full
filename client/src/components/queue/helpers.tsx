import { useState } from 'react'
import { Sparkles, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { StockPicker } from '@/components/shared/StockPicker'
import { WhtPanel } from '@/components/shared/WhtPanel'
import { apiError } from '@/lib/api/spend'
import { aiApi } from '@/lib/api/ai'
import type { ImprovedDescription, ImproveDescriptionInput } from '@/types/spend'
import type { StockItem } from '@/types/vendors'

/** "Pick from stock" — the shared StockPicker; pre-fills the caller's fields via onPick. */
export function StockSelect({ onPick, className, disabled }: { onPick: (s: StockItem) => void; className?: string; disabled?: boolean }) {
  return <StockPicker onPick={onPick} disabled={disabled} className={className} />
}

/**
 * Withholding-tax panel — the shared WhtPanel (server-resolved rate, 2%/5% chips, override). Setting or overriding WHT
 * is approver-only (the server enforces it too), so the panel is read-only for others.
 */
export function WhtBox({
  vendorId,
  coaName,
  total,
  override,
  onOverride,
  canOverride,
  className,
}: {
  vendorId?: string | null
  coaName?: string | null
  total: number
  override: number | null
  onOverride: (rate: number | null) => void
  canOverride: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <WhtPanel vendorId={vendorId} coa={coaName} total={total} overrideRate={override} onOverrideChange={onOverride} disabled={!canOverride} />
      {!canOverride && <div className="mt-1 text-[11px] text-text-muted">An approver can set or override WHT.</div>}
    </div>
  )
}

/** Runs AI tidy-up on many inputs; `results` feeds the shared ReviewDescriptionsDialog. */
export function useAiTidy() {
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ImprovedDescription[] | null>(null)
  const run = async (items: ImproveDescriptionInput[]) => {
    const valid = items.filter((i) => i.description.trim())
    if (!valid.length) {
      toast.error('Type a description first')
      return null
    }
    setBusy(true)
    try {
      const res = await aiApi.improveDescriptions(valid)
      setResults(res.items)
      return res.items
    } catch (e) {
      toast.error(apiError(e, 'AI tidy-up failed'))
      return null
    } finally {
      setBusy(false)
    }
  }
  return { busy, results, setResults, run }
}

/** Single-field "Tidy up with AI" + "Undo AI change". Applies directly (single line). */
export function AiTidyInline({
  description,
  vendorName,
  date,
  amount,
  onChange,
  onSuggest,
  disabled,
}: {
  description: string
  vendorName?: string | null
  date?: string
  amount?: number
  onChange: (v: string) => void
  onSuggest?: (s: NonNullable<ImprovedDescription['suggestion']>) => void
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState<string | null>(null)
  const tidy = async () => {
    if (!description.trim()) return toast.error('Type a description first')
    setBusy(true)
    try {
      const res = await aiApi.improveDescriptions([{ description, vendorName: vendorName || undefined, date, amount }])
      const r = res.items[0]
      if (r?.changed) {
        setUndo(description)
        onChange(r.improved)
        toast.success('Description tidied')
      } else toast.message('Already follows the guide')
      if (r?.suggestion && onSuggest) onSuggest(r.suggestion)
    } catch (e) {
      toast.error(apiError(e, 'AI tidy-up failed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={disabled || busy} onClick={tidy} className="inline-flex items-center gap-1 text-[11px] font-semibold text-gold hover:underline disabled:opacity-50">
        <Sparkles size={12} className={busy ? 'animate-pulse' : ''} /> {busy ? 'Tidying…' : 'Tidy up with AI'}
      </button>
      {undo !== null && (
        <button
          type="button"
          onClick={() => {
            onChange(undo)
            setUndo(null)
          }}
          className="inline-flex items-center gap-1 text-[11px] text-text-dim hover:text-foreground"
        >
          <Undo2 size={12} /> Undo AI change
        </button>
      )}
    </span>
  )
}

/** Read a picked file as text. */
export const readFileText = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(r.error)
    r.readAsText(f)
  })

/** Save a blob as a file. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
