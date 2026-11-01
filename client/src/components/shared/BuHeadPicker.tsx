import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useCostCenters } from './hooks'

export interface BuHeadValue {
  costCenterId: string | null
  locationId: string | null
}

/**
 * Business Unit then BU Head (heads of the chosen BU, General first shown as "✦ General (split)"); changing BU clears the head.
 * Props: costCenterId, locationId, onChange(value), required? (BU required, per workspace setting), disabled?, showLabels?, layout?, className?.
 */
export function BuHeadPicker({
  costCenterId,
  locationId,
  onChange,
  required,
  disabled,
  showLabels = true,
  layout = 'row',
  className,
}: {
  costCenterId: string | null | undefined
  locationId: string | null | undefined
  onChange: (v: BuHeadValue) => void
  required?: boolean
  disabled?: boolean
  showLabels?: boolean
  layout?: 'row' | 'stack'
  className?: string
}) {
  const { data: bus = [] } = useCostCenters()
  const active = bus.filter((b) => b.isActive || b.id === costCenterId)
  const heads = (bus.find((b) => b.id === costCenterId)?.locations ?? []).filter((l) => l.isActive || l.id === locationId)

  return (
    <div className={cn('grid gap-3', layout === 'row' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1', className)}>
      <div className="space-y-1.5">
        {showLabels && <Label required={required}>Business Unit</Label>}
        <Select
          value={costCenterId ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ costCenterId: e.target.value || null, locationId: null })}
        >
          <option value="">{required ? 'Select business unit…' : '— None —'}</option>
          {active.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.code ? ` (${b.code})` : ''}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        {showLabels && <Label>BU Head</Label>}
        <Select
          value={locationId ?? ''}
          disabled={disabled || !costCenterId}
          onChange={(e) => onChange({ costCenterId: costCenterId ?? null, locationId: e.target.value || null })}
        >
          <option value="">{costCenterId ? '— None —' : 'Pick a business unit first'}</option>
          {heads.map((h) => (
            <option key={h.id} value={h.id}>
              {h.isGeneral ? '✦ General (split)' : h.name}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}
