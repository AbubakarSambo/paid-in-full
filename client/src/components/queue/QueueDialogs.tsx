import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Plus, RotateCcw, X, AlertTriangle } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn, formatDate } from '@/lib/utils'
import { formatNaira } from '@/lib/money'
import { payCategoriesApi } from '@/lib/api/spend'
import { spendKeys } from '@/components/shared/hooks'
import { apiErrorMessage, queueApi, queueKeys } from '@/lib/api/queue'
import type { BudgetProjection, QueueListItem } from '@/types/queue'
import { Chip, Field, ModalFooter } from './common'

// ─── Split ────────────────────────────────────────────────────────────────

export function SplitDialog({ item, onClose }: { item: QueueListItem | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'even' | 'custom'>('even')
  const [parts, setParts] = useState(2)
  const [lines, setLines] = useState<{ amount: string; description: string }[]>([])

  useEffect(() => {
    if (!item) return
    setMode('even')
    setParts(2)
    const half = Math.round((item.total / 2) * 100) / 100
    setLines([
      { amount: String(half), description: '' },
      { amount: String(Math.round((item.total - half) * 100) / 100), description: '' },
    ])
  }, [item])

  const total = item?.total ?? 0
  const sum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const balanced = Math.abs(sum - total) < 0.01

  const split = useMutation({
    mutationFn: () =>
      queueApi.split(
        item!.id,
        mode === 'even'
          ? { parts }
          : { lines: lines.map((l) => ({ amount: Number(l.amount), description: l.description.trim() || undefined })) },
      ),
    onSuccess: () => {
      toast.success('Item split')
      qc.invalidateQueries({ queryKey: queueKeys.all })
      onClose()
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })

  return (
    <Modal isOpen={!!item} onClose={onClose} title="Split item" description="Break one line into smaller lines. The new lines replace the original.">
      {item && (
        <div className="space-y-4">
          <div className="rounded-xl bg-surface2 p-3 text-sm">
            <div className="truncate font-medium">{item.description}</div>
            <div className="text-text-dim">
              {item.vendorName} · <span className="font-semibold tabular-nums text-foreground">{formatNaira(item.total)}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {(['even', 'custom'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-semibold',
                  mode === m ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-dim',
                )}
              >
                {m === 'even' ? 'Split evenly' : 'Custom amounts'}
              </button>
            ))}
          </div>
          {mode === 'even' ? (
            <Field label="Number of lines" hint={`≈ ${formatNaira(total / Math.max(2, parts))} each`}>
              <Input type="number" min={2} max={50} value={parts} onChange={(e) => setParts(Math.max(2, Math.min(50, Number(e.target.value) || 2)))} />
            </Field>
          ) : (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    className="w-32"
                    type="number"
                    step="any"
                    value={l.amount}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                  />
                  <Input
                    placeholder="Description (optional)"
                    value={l.description}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                  />
                  {lines.length > 2 && (
                    <button className="px-2 text-text-dim hover:text-red" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between text-xs">
                <button className="inline-flex items-center gap-1 font-semibold text-gold" onClick={() => setLines((ls) => [...ls, { amount: '', description: '' }])}>
                  <Plus size={12} /> Add line
                </button>
                <span className={balanced ? 'text-green' : 'text-orange'}>
                  {formatNaira(sum)} of {formatNaira(total)}
                  {!balanced && ` · ${formatNaira(total - sum)} left`}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
      <ModalFooter>
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={mode === 'custom' && !balanced} isLoading={split.isPending} onClick={() => split.mutate()}>
          Split
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// ─── Reject ───────────────────────────────────────────────────────────────

export function RejectDialog({ item, onClose }: { item: QueueListItem | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  useEffect(() => setReason(''), [item])
  const reject = useMutation({
    mutationFn: () => queueApi.reject(item!.id, reason.trim()),
    onSuccess: () => {
      toast.success('Rejected — moved to the Rejected view')
      qc.invalidateQueries({ queryKey: queueKeys.all })
      onClose()
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })
  return (
    <Modal isOpen={!!item} onClose={onClose} title="Cancel this item?" description="It won't be paid. Rejected items can be restored from the Rejected view.">
      {item && (
        <div className="space-y-3">
          <div className="rounded-xl bg-surface2 p-3 text-sm">
            <div className="truncate font-medium">{item.description}</div>
            <div className="text-text-dim">
              {item.vendorName} · {formatNaira(item.total)}
            </div>
          </div>
          <Field label="Reason" required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why won't this be paid?" />
          </Field>
        </div>
      )}
      <ModalFooter>
        <Button variant="outline" size="sm" onClick={onClose}>
          Back
        </Button>
        <Button variant="destructive" size="sm" disabled={reason.trim().length < 2} isLoading={reject.isPending} onClick={() => reject.mutate()}>
          Reject item
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// ─── Rejected view ────────────────────────────────────────────────────────

export function RejectedView({ open, onClose, canApprove }: { open: boolean; onClose: () => void; canApprove: boolean }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const { data = [], isLoading } = useQuery({
    queryKey: queueKeys.rejected(search),
    queryFn: () => queueApi.rejected(search),
    enabled: open,
  })
  const restore = useMutation({
    mutationFn: (id: string) => queueApi.restore(id),
    onSuccess: () => {
      toast.success('Restored to the queue')
      qc.invalidateQueries({ queryKey: queueKeys.all })
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })
  return (
    <Modal isOpen={open} onClose={onClose} title="Rejected items" description="Won't be paid. Restore to send back to the queue." className="max-w-3xl">
      <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3" />
      {isLoading ? (
        <div className="py-8 text-center text-sm text-text-dim">Loading…</div>
      ) : data.length === 0 ? (
        <div className="py-8 text-center text-sm text-text-dim">No rejected items.</div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {data.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.description}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-dim">
                  <span>{r.vendor?.name ?? r.vendorName}</span>
                  {r.payCategoryName && <Chip>{r.payCategoryName}</Chip>}
                  {r.coaTag && <Chip>{r.coaTag}</Chip>}
                  <Chip tone="red">{r.status}</Chip>
                </div>
                {r.rejectedReason && (
                  <div className="mt-0.5 text-[11px] text-text-muted">
                    “{r.rejectedReason}”{r.rejectedByName ? ` — ${r.rejectedByName}` : ''}
                    {r.rejectedAt ? `, ${formatDate(r.rejectedAt)}` : ''}
                  </div>
                )}
              </div>
              <span className="text-sm font-semibold tabular-nums">{formatNaira(r.total)}</span>
              {canApprove && (
                <Button size="sm" variant="outline" isLoading={restore.isPending && restore.variables === r.id} onClick={() => restore.mutate(r.id)}>
                  <RotateCcw size={13} /> Restore
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <ModalFooter>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// ─── Budget warning ───────────────────────────────────────────────────────

export function BudgetWarningModal({
  projections,
  onCancel,
  onProceed,
  busy,
}: {
  projections: BudgetProjection[] | null
  onCancel: () => void
  onProceed: () => void
  busy?: boolean
}) {
  return (
    <Modal
      isOpen={!!projections}
      onClose={onCancel}
      title="Budget Warning"
      description="This approval would take some COA tags over their monthly cap. You can still proceed — both choices are recorded in the audit log."
      className="max-w-3xl"
    >
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-[10px] uppercase tracking-wider text-text-dim">
            <tr>
              <th className="px-3 py-2 text-left">Tag</th>
              <th className="px-3 py-2 text-right">Cap</th>
              <th className="px-3 py-2 text-right">Spent</th>
              <th className="px-3 py-2 text-right">+This</th>
              <th className="px-3 py-2 text-right">Projected</th>
              <th className="px-3 py-2 text-right">Over by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {(projections ?? []).map((p) => (
              <tr key={`${p.coaTagId}-${p.costCenterId}-${p.period}`} className={p.overBy > 0 ? 'bg-red/5' : ''}>
                <td className="px-3 py-2">
                  <div className="font-medium">{p.coaTag}</div>
                  <div className="text-[11px] text-text-muted">
                    {p.period}
                    {p.costCenter ? ` · ${p.costCenter}` : ''}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">{formatNaira(p.cap)}</td>
                <td className="px-3 py-2 text-right">{formatNaira(p.spent)}</td>
                <td className="px-3 py-2 text-right">{formatNaira(p.thisAmount)}</td>
                <td className="px-3 py-2 text-right">{formatNaira(p.projected)}</td>
                <td className={cn('px-3 py-2 text-right font-semibold', p.overBy > 0 ? 'text-red' : 'text-text-dim')}>
                  {p.overBy > 0 ? formatNaira(p.overBy) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ModalFooter>
        <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" isLoading={busy} onClick={onProceed}>
          <AlertTriangle size={14} /> Proceed anyway
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// ─── Sticky selection bar ─────────────────────────────────────────────────

export interface SelectionGroup {
  payCategoryId: string | null
  name: string
  color: string
  ids: string[]
  total: number
}

export function SelectionBar({
  groups,
  total,
  count,
  canApprove,
  batchRefs,
  onBatchRef,
  onApprove,
  approvingId,
  onClear,
}: {
  groups: SelectionGroup[]
  total: number
  count: number
  canApprove: boolean
  batchRefs: Record<string, string>
  onBatchRef: (catId: string, v: string) => void
  onApprove: (g: SelectionGroup) => void
  approvingId: string | null
  onClear: () => void
}) {
  if (!count) return null
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 shadow-2xl backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 lg:flex-row lg:items-center">
        <div className="shrink-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Selected</div>
          <div className="text-lg font-bold tabular-nums">
            {formatNaira(total)} <span className="text-sm font-medium text-text-dim">· {count} item{count === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="flex flex-1 flex-wrap gap-2">
          {groups.map((g) => (
            <div key={g.payCategoryId ?? 'none'} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface2 px-2.5 py-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
              <span className="text-xs font-bold uppercase tracking-wider">{g.name}</span>
              <span className="text-xs tabular-nums text-text-dim">{formatNaira(g.total)}</span>
              {canApprove && g.payCategoryId && (
                <>
                  <input
                    value={batchRefs[g.payCategoryId] ?? ''}
                    onChange={(e) => onBatchRef(g.payCategoryId!, e.target.value)}
                    placeholder="Batch ref (auto)"
                    title="Batch reference — leave blank to auto-generate"
                    className="h-7 w-36 rounded-md border border-input bg-card px-2 text-xs"
                  />
                  <Button
                    size="sm"
                    className="h-7 bg-green px-3 text-white hover:brightness-110"
                    isLoading={approvingId === g.payCategoryId}
                    disabled={!!approvingId}
                    onClick={() => onApprove(g)}
                  >
                    <Check size={13} /> Approve
                  </Button>
                </>
              )}
            </div>
          ))}
          {!canApprove && <span className="self-center text-[11px] text-text-muted">Approver role required to approve.</span>}
        </div>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear all
        </Button>
      </div>
    </div>
  )
}

// ─── + Add Category (admin quick create) ──────────────────────────────────

const PALETTE = ['#22D3EE', '#F4B942', '#4CAF6E', '#A78BFA', '#E8923A', '#4F8AFF', '#E05252', '#94A3B8']

export function AddCategoryCard() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[0])
  const [budgeted, setBudgeted] = useState(false)
  const create = useMutation({
    mutationFn: () => payCategoriesApi.create({ name: name.trim().toUpperCase(), color, includeInBudgets: budgeted }),
    onSuccess: () => {
      toast.success('Category created')
      qc.invalidateQueries({ queryKey: spendKeys.payCategories })
      qc.invalidateQueries({ queryKey: queueKeys.all })
      setOpen(false)
      setName('')
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-5 text-sm font-semibold text-text-dim hover:border-gold/50 hover:text-gold transition-colors"
      >
        <Plus size={16} /> Add Category
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="New payment category" description="Add COA tags for it in Settings → COA tags.">
        <div className="space-y-4">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. MARKETING" autoFocus />
          </Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cn('h-7 w-7 rounded-full border-2', color === c ? 'border-foreground' : 'border-transparent')}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="accent-[var(--gold)]" checked={budgeted} onChange={(e) => setBudgeted(e.target.checked)} />
            Include in budgets (OPEX-style monthly caps)
          </label>
        </div>
        <ModalFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!name.trim()} isLoading={create.isPending} onClick={() => create.mutate()}>
            Create
          </Button>
        </ModalFooter>
      </Modal>
    </>
  )
}
