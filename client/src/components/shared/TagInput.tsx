import { useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Chip input: type and press Enter (or comma) to add; Backspace on empty removes the last. Props: value, onChange(tags), placeholder?, disabled?, suggestions?. */
export function TagInput({
  value,
  onChange,
  placeholder = 'Type a tag and press Enter',
  disabled,
  suggestions = [],
}: {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  disabled?: boolean
  suggestions?: string[]
}) {
  const [draft, setDraft] = useState('')
  const add = (raw: string) => {
    const t = raw.replace(/\s+/g, ' ').trim().replace(/,$/, '')
    if (!t || value.some((v) => v.toLowerCase() === t.toLowerCase())) return setDraft('')
    onChange([...value, t])
    setDraft('')
  }
  const sugg = draft
    ? suggestions.filter((s) => s.toLowerCase().includes(draft.toLowerCase()) && !value.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 6)
    : []
  return (
    <div>
      <div
        className={cn(
          'flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-input bg-card px-2 py-1.5',
          disabled && 'opacity-50',
        )}
      >
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-md bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold">
            {t}
            {!disabled && (
              <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((v) => v !== t))}>
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        <input
          disabled={disabled}
          value={draft}
          onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            } else if (e.key === 'Backspace' && !draft && value.length) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => draft && add(draft)}
          placeholder={value.length ? '' : placeholder}
          className="min-w-[8rem] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground/70"
        />
      </div>
      {sugg.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {sugg.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s)}
              className="rounded-md border border-border px-2 py-0.5 text-[11px] text-text-dim hover:border-gold hover:text-gold"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
