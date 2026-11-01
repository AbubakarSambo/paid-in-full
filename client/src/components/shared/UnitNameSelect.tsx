import { Select } from '@/components/ui/select'

/** Spec §5.2 unit list. */
export const UNIT_NAMES = [
  'Pcs', 'Pack', 'Box', 'Carton', 'Bag', 'Sack', 'Bundle', 'Roll', 'Kg', 'g', 'Tonne', 'Litre', 'ml', 'Gallon', 'Sqm', 'Sqft',
  'Metre', 'cm', 'Hour', 'Day', 'Week', 'Month', 'Year', 'Trip', 'Visit', 'Plate', 'Bottle', 'Lot', 'Unit',
]

/** Unit name dropdown (spec list). Props: value, onChange(unit), disabled?, className?. Keeps an unknown current value selectable. */
export function UnitNameSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: string | null | undefined
  onChange: (unit: string) => void
  disabled?: boolean
  className?: string
}) {
  const v = value ?? ''
  const match = UNIT_NAMES.find((u) => u.toLowerCase() === v.toLowerCase())
  return (
    <Select value={match ?? v} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={className}>
      <option value="">Unit…</option>
      {v && !match && <option value={v}>{v}</option>}
      {UNIT_NAMES.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </Select>
  )
}
