import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'

/** Card wrapper used by the Spend settings sections. Props: id, title, description?, actions?, children. */
export function SettingsSection({ id, title, description, actions, children }: { id: string; title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-text-dim">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/** "Read-only — Admin role required to edit". */
export function AdminOnlyNote() {
  return <p className="mb-3 rounded-lg bg-secondary px-3 py-2 text-xs text-text-dim">Read-only — Admin role required to edit</p>
}

/** Move an id up/down in a list; returns the new id order. */
export function moveId(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return ids
  const next = [...ids]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** Up/down reorder buttons. */
export function ReorderButtons({ onUp, onDown, disableUp, disableDown }: { onUp: () => void; onDown: () => void; disableUp?: boolean; disableDown?: boolean }) {
  return (
    <span className="inline-flex">
      <button type="button" disabled={disableUp} onClick={onUp} className="rounded p-1 text-text-dim hover:text-foreground disabled:opacity-30" aria-label="Move up">
        <ArrowUp size={13} />
      </button>
      <button type="button" disabled={disableDown} onClick={onDown} className="rounded p-1 text-text-dim hover:text-foreground disabled:opacity-30" aria-label="Move down">
        <ArrowDown size={13} />
      </button>
    </span>
  )
}
