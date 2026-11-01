import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { aiApi } from '@/lib/api/ai'
import { apiError } from '@/lib/api/spend'
import type { ImproveDescriptionInput, ImprovedDescription } from '@/types/spend'
import { ReviewDescriptionsDialog, type AppliedDescription } from './ReviewDescriptionsDialog'

/**
 * "Tidy up with AI" button: sends `items` to /ai/improve-descriptions, then opens the Review descriptions diff
 * (Revert / Save with these). Props: items ({id?, description, vendorName?, date?, amount?}[]), onApply(rows: {id, description, suggestion}[]),
 * label?, size? ('sm'|'default'), disabled?, skipReview? (apply directly without the dialog).
 */
export function AiTidyButton({
  items,
  onApply,
  label = 'Tidy up with AI',
  size = 'sm',
  disabled,
  skipReview,
}: {
  items: ImproveDescriptionInput[]
  onApply: (rows: AppliedDescription[]) => void
  label?: string
  size?: 'sm' | 'default'
  disabled?: boolean
  skipReview?: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ImprovedDescription[] | null>(null)
  const usable = items.filter((i) => i.description.trim())

  const run = async () => {
    if (!usable.length) return toast.error('Type a description first')
    setLoading(true)
    try {
      const r = await aiApi.improveDescriptions(usable)
      if (skipReview) onApply(r.items.map((x) => ({ id: x.id, description: x.improved, suggestion: x.suggestion })))
      else setResults(r.items)
    } catch (e) {
      toast.error(apiError(e, 'AI tidy-up failed'))
    } finally {
      setLoading(false)
    }
  }

  const vendorNames = Object.fromEntries(usable.filter((i) => i.id).map((i) => [i.id as string, i.vendorName]))
  return (
    <>
      <Button type="button" size={size} variant="outline" onClick={run} isLoading={loading} disabled={disabled || !usable.length}>
        {!loading && <Sparkles size={14} />} {label}
      </Button>
      <ReviewDescriptionsDialog
        open={!!results}
        onClose={() => setResults(null)}
        results={results ?? []}
        onSave={onApply}
        vendorNames={vendorNames}
      />
    </>
  )
}
