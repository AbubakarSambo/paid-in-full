import { useEffect, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ImprovedDescription } from '@/types/spend'
import { MicroChip } from './Popover'
import { validateDescription } from './descriptionRules'

export interface AppliedDescription {
  id: string | null
  description: string
  /** AI category/COA suggestion (only when the row kept the AI text). */
  suggestion: ImprovedDescription['suggestion']
}

/**
 * "Review descriptions" diff modal (spec §7): original → improved per row, editable, with per-row Revert,
 * and "Save with these". Props: open, onClose, results (from /ai/improve-descriptions), onSave(rows), vendorNames? (id → vendor name for re-validation).
 */
export function ReviewDescriptionsDialog({
  open,
  onClose,
  results,
  onSave,
  vendorNames,
}: {
  open: boolean
  onClose: () => void
  results: ImprovedDescription[]
  onSave: (rows: AppliedDescription[]) => void
  vendorNames?: Record<string, string | undefined>
}) {
  const [texts, setTexts] = useState<string[]>([])
  useEffect(() => {
    if (open) setTexts(results.map((r) => r.improved))
  }, [open, results])

  return (
    <Modal isOpen={open} onClose={onClose} title="Review descriptions" description="Check the tidied text. Revert any line you'd rather keep as written." className="max-w-3xl">
      <div className="space-y-3">
        {results.map((r, i) => {
          const text = texts[i] ?? r.improved
          const reverted = text === r.original
          const errs = validateDescription(text, r.id ? vendorNames?.[r.id] : undefined)
          return (
            <div key={r.id ?? i} className="rounded-xl border border-border p-3">
              <div className="text-xs text-text-dim line-through decoration-red/60">{r.original}</div>
              <div className="mt-1.5 flex items-center gap-2">
                <Input value={text} onChange={(e) => setTexts((t) => t.map((x, j) => (j === i ? e.target.value : x)))} className="h-9" />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={reverted}
                  onClick={() => setTexts((t) => t.map((x, j) => (j === i ? r.original : x)))}
                  title="Revert to original"
                >
                  <Undo2 size={14} /> Revert
                </Button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {!r.changed && <MicroChip className="text-text-dim">Unchanged</MicroChip>}
                {r.suggestion && !reverted && (
                  <MicroChip className="text-blue">
                    {r.suggestion.payCategoryName} · {r.suggestion.coaTagName}
                  </MicroChip>
                )}
                {errs.length === 0 ? (
                  <MicroChip className="text-green">OK</MicroChip>
                ) : (
                  <span className="text-[11px] text-orange">{errs.join(' ')}</span>
                )}
              </div>
            </div>
          )
        })}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={() => setTexts(results.map((r) => r.original))}>
            Revert all
          </Button>
          <Button
            onClick={() => {
              onSave(results.map((r, i) => ({ id: r.id, description: texts[i] ?? r.improved, suggestion: texts[i] === r.original ? null : r.suggestion })))
              onClose()
            }}
          >
            Save with these
          </Button>
        </div>
      </div>
    </Modal>
  )
}
