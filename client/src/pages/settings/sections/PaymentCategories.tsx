import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/dialog'
import { apiError, apiStatus, payCategoriesApi } from '@/lib/api/spend'
import { usePermissions } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { spendKeys, usePayCategories } from '@/components/shared/hooks'
import { AdminOnlyNote, ReorderButtons, SettingsSection, moveId } from '@/components/shared/SettingsSection'
import type { PayCategory } from '@/types/spend'

/** Spec §11 category colour palette. */
export const CATEGORY_PALETTE = ['#22D3EE', '#7AB87A', '#5BA8C9', '#C97A7A', '#B59ED4', '#E89B59', '#8B8FA3']

export default function PaymentCategories() {
  const qc = useQueryClient()
  const { isAdmin } = usePermissions()
  const { data: cats = [], isLoading } = usePayCategories()
  const [name, setName] = useState('')
  const [color, setColor] = useState(CATEGORY_PALETTE[0])
  const [deleting, setDeleting] = useState<PayCategory | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: spendKeys.payCategories })
    qc.invalidateQueries({ queryKey: spendKeys.coaTags })
  }
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast.success(ok)
      refresh()
      return true
    } catch (e) {
      toast.error(apiError(e))
      return false
    }
  }

  const add = async () => {
    if (!name.trim()) return
    if (await act(() => payCategoriesApi.create({ name: name.trim(), color }), 'Category added')) {
      setName('')
      setColor(CATEGORY_PALETTE[(cats.length + 1) % CATEGORY_PALETTE.length])
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await payCategoriesApi.remove(deleting.id)
      toast.success(`${deleting.name} deleted`)
      refresh()
      setDeleting(null)
    } catch (e) {
      toast.error(apiStatus(e) === 409 ? apiError(e) : apiError(e, 'Could not delete'))
      setDeleting(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection id="payment-categories" title="Payment Categories" description="Each category becomes a queue lane and a batch. BUDGETED categories are tracked on the Budgets tab.">
      {!isAdmin && <AdminOnlyNote />}
      {isLoading && <p className="text-sm text-text-dim">Loading…</p>}
      <div className="divide-y divide-border rounded-xl border border-border">
        {cats.map((c, i) => (
          <CategoryRow
            key={c.id}
            cat={c}
            isAdmin={isAdmin}
            first={i === 0}
            last={i === cats.length - 1}
            onMove={(dir) => act(() => payCategoriesApi.reorder(moveId(cats.map((x) => x.id), c.id, dir)))}
            onUpdate={(body, ok) => act(() => payCategoriesApi.update(c.id, body), ok)}
            onDelete={() => setDeleting(c)}
          />
        ))}
      </div>
      {isAdmin && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" className="max-w-xs" onKeyDown={(e) => e.key === 'Enter' && add()} />
          <ColorDots value={color} onChange={setColor} />
          <Button size="sm" className="h-11" onClick={add} disabled={!name.trim()}>
            <Plus size={14} /> Add Category
          </Button>
        </div>
      )}
      <ConfirmDialog
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        isLoading={busy}
        isDangerous
        title="Delete category?"
        description={`Delete "${deleting?.name ?? ''}" and its COA tags? Categories already used on queue items, batches, budgets or stock can't be deleted — rename or turn them off instead.`}
        confirmText="Delete"
      />
    </SettingsSection>
  )
}

function ColorDots({ value, onChange, disabled }: { value: string; onChange: (c: string) => void; disabled?: boolean }) {
  return (
    <span className="inline-flex gap-1">
      {CATEGORY_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          onClick={() => onChange(c)}
          aria-label={`Colour ${c}`}
          className={cn('h-5 w-5 rounded-full border-2', value.toLowerCase() === c.toLowerCase() ? 'border-foreground' : 'border-transparent')}
          style={{ background: c }}
        />
      ))}
    </span>
  )
}

function CategoryRow({
  cat,
  isAdmin,
  first,
  last,
  onMove,
  onUpdate,
  onDelete,
}: {
  cat: PayCategory
  isAdmin: boolean
  first: boolean
  last: boolean
  onMove: (dir: -1 | 1) => void
  onUpdate: (body: Partial<{ name: string; color: string; includeInBudgets: boolean; isActive: boolean }>, ok?: string) => Promise<boolean>
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(cat.name)
  const [pickColor, setPickColor] = useState(false)
  return (
    <div className={cn('flex flex-wrap items-center gap-3 px-3 py-2.5', !cat.isActive && 'opacity-60')}>
      <button
        type="button"
        disabled={!isAdmin}
        onClick={() => setPickColor((p) => !p)}
        className="h-3.5 w-3.5 shrink-0 rounded-full"
        style={{ background: cat.color }}
        aria-label="Change colour"
      />
      {pickColor && isAdmin && (
        <ColorDots
          value={cat.color}
          onChange={(c) => {
            setPickColor(false)
            void onUpdate({ color: c })
          }}
        />
      )}
      {editing ? (
        <span className="flex items-center gap-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-48" autoFocus />
          <button className="text-green" aria-label="Save" onClick={() => onUpdate({ name: name.trim() }, 'Renamed').then((ok) => ok && setEditing(false))}>
            <Check size={15} />
          </button>
          <button
            className="text-text-dim"
            aria-label="Cancel"
            onClick={() => {
              setName(cat.name)
              setEditing(false)
            }}
          >
            <X size={15} />
          </button>
        </span>
      ) : (
        <span className="font-semibold">{cat.name}</span>
      )}
      <span className="text-[11px] text-text-dim">{cat._count?.coaTags ?? 0} COA</span>
      <span className="ml-auto flex items-center gap-2">
        <button
          type="button"
          disabled={!isAdmin}
          onClick={() => onUpdate({ includeInBudgets: !cat.includeInBudgets })}
          className={cn(
            'rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
            cat.includeInBudgets ? 'border-green/40 bg-green/10 text-green' : 'border-border text-text-dim',
          )}
        >
          {cat.includeInBudgets ? 'Budgeted' : 'No budget'}
        </button>
        {isAdmin && (
          <>
            <ReorderButtons onUp={() => onMove(-1)} onDown={() => onMove(1)} disableUp={first} disableDown={last} />
            {!cat.isActive && (
              <button className="text-xs text-gold hover:underline" onClick={() => onUpdate({ isActive: true }, 'Turned on')}>
                Turn on
              </button>
            )}
            <button className="rounded p-1 text-text-dim hover:text-foreground" aria-label="Rename" onClick={() => setEditing(true)}>
              <Pencil size={13} />
            </button>
            <button className="rounded p-1 text-text-dim hover:text-red" aria-label="Delete" onClick={onDelete}>
              <Trash2 size={13} />
            </button>
          </>
        )}
      </span>
    </div>
  )
}
