import { useMemo } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { DESCRIPTION_PATTERN, validateDescription } from './descriptionRules'

/**
 * Lists Description Rules (spec §7) issues for `description`, using the client mirror of the server validator.
 * Props: description, vendorName? (rule: don't repeat it), showWhenEmpty? (default false), showOk? (default true).
 */
export function DescriptionRulesHint({
  description,
  vendorName,
  showWhenEmpty = false,
  showOk = true,
}: {
  description: string
  vendorName?: string | null
  showWhenEmpty?: boolean
  showOk?: boolean
}) {
  const errors = useMemo(() => validateDescription(description, vendorName), [description, vendorName])
  if (!description.trim() && !showWhenEmpty) {
    return <p className="mt-1 text-[11px] text-text-dim">Format: {DESCRIPTION_PATTERN}</p>
  }
  if (!errors.length) {
    return showOk ? (
      <p className="mt-1 flex items-center gap-1 text-[11px] text-green">
        <CheckCircle2 size={12} /> Matches the description guide
      </p>
    ) : null
  }
  return (
    <ul className="mt-1 space-y-0.5">
      {errors.map((e) => (
        <li key={e} className="flex items-start gap-1 text-[11px] text-orange">
          <AlertCircle size={12} className="mt-0.5 shrink-0" /> {e}
        </li>
      ))}
    </ul>
  )
}
