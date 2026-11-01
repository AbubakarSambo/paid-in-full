import { useMemo } from 'react'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useCoaTags, usePayCategories } from './hooks'

export interface CategoryCoaValue {
  payCategoryId: string | null
  coaTagId: string | null
  /** Names are included for WHT resolution / display. */
  payCategoryName?: string | null
  coaTagName?: string | null
}

/**
 * Payment category then COA (COA list filtered by the chosen category; changing category clears the COA).
 * Props: payCategoryId, coaTagId, onChange(value), required?, disabled?, showLabels? (default true), layout? 'row'|'stack', className?.
 */
export function CategoryCoaPicker({
  payCategoryId,
  coaTagId,
  onChange,
  required,
  disabled,
  showLabels = true,
  layout = 'row',
  className,
}: {
  payCategoryId: string | null | undefined
  coaTagId: string | null | undefined
  onChange: (v: CategoryCoaValue) => void
  required?: boolean
  disabled?: boolean
  showLabels?: boolean
  layout?: 'row' | 'stack'
  className?: string
}) {
  const { data: cats = [] } = usePayCategories()
  const { data: tags = [] } = useCoaTags()
  const activeCats = cats.filter((c) => c.isActive || c.id === payCategoryId)
  const filtered = useMemo(() => tags.filter((t) => t.payCategoryId === payCategoryId), [tags, payCategoryId])

  return (
    <div className={cn('grid gap-3', layout === 'row' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1', className)}>
      <div className="space-y-1.5">
        {showLabels && <Label required={required}>Payment Category</Label>}
        <Select
          value={payCategoryId ?? ''}
          disabled={disabled}
          onChange={(e) => {
            const cat = cats.find((c) => c.id === e.target.value)
            onChange({ payCategoryId: cat?.id ?? null, payCategoryName: cat?.name ?? null, coaTagId: null, coaTagName: null })
          }}
        >
          <option value="">Select category…</option>
          {activeCats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        {showLabels && <Label required={required}>COA</Label>}
        <Select
          value={coaTagId ?? ''}
          disabled={disabled || !payCategoryId}
          onChange={(e) => {
            const tag = filtered.find((t) => t.id === e.target.value)
            const cat = cats.find((c) => c.id === payCategoryId)
            onChange({ payCategoryId: payCategoryId ?? null, payCategoryName: cat?.name ?? null, coaTagId: tag?.id ?? null, coaTagName: tag?.name ?? null })
          }}
        >
          <option value="">{payCategoryId ? (filtered.length ? 'Select COA…' : 'No COA tags in this category') : 'Pick a category first'}</option>
          {filtered.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}
