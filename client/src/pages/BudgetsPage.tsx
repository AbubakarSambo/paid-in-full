import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BarChart3, ChevronLeft, ChevronRight, Copy, Plus, Search, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatNaira } from '@/lib/money'
import { usePermissions } from '@/lib/permissions'
import { budgetKeys, budgetsApi } from '@/lib/api/budgets'
import { apiErrorMessage } from '@/lib/api/queue'
import { spendKeys } from '@/components/shared/hooks'
import { monthISO, usePersistentState } from '@/components/queue/common'
import { BudgetRow } from '@/components/budgets/BudgetRow'
import { VarianceModal } from '@/components/budgets/VarianceModal'
import { ImportBudgetWizard } from '@/components/budgets/ImportBudgetWizard'

const shiftMonth = (period: string, delta: number) => {
  const [y, m] = period.split('-').map(Number)
  return monthISO(new Date(y, m - 1 + delta, 1))
}
const monthLabel = (period: string) => {
  const [y, m] = period.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export default function BudgetsPage() {
  const qc = useQueryClient()
  const perms = usePermissions()
  const [period, setPeriod] = useState(monthISO())
  const [bu, setBu] = usePersistentState<string>('pif.budgets.bu', 'all')
  const [filter, setFilter] = useState('')
  const [newTag, setNewTag] = useState('')
  const [varianceOpen, setVarianceOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: budgetKeys.overview(period, bu),
    queryFn: () => budgetsApi.overview(period, bu),
  })
  const businessUnits = data?.businessUnits ?? []
  // Caps are per BU (or workspace-wide); the "All" view aggregates and is read-only.
  const canEdit = perms.canApprove && bu !== 'all'
  const editHint = perms.canApprove && bu === 'all' ? 'Pick a BU to edit' : undefined

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (data?.rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || r.payCategory.name.toLowerCase().includes(q))
  }, [data, filter])

  const invalidate = () => qc.invalidateQueries({ queryKey: budgetKeys.all })

  const upsert = useMutation({
    mutationFn: (v: { coaTagId: string; amount: number }) =>
      budgetsApi.upsert({ coaTagId: v.coaTagId, amount: v.amount, period, costCenterId: bu === 'none' ? undefined : bu }),
    onSuccess: () => {
      toast.success('Cap saved')
      invalidate()
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => budgetsApi.remove(id),
    onSuccess: () => {
      toast.success('Cap removed')
      invalidate()
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })
  const copyPrev = useMutation({
    mutationFn: () => budgetsApi.copyPrevious({ period, costCenterId: bu !== 'all' && bu !== 'none' ? bu : undefined }),
    onSuccess: (r) => {
      toast.success(r.copied ? `Copied ${r.copied} cap${r.copied === 1 ? '' : 's'} from ${monthLabel(r.from)}${r.skipped ? ` · ${r.skipped} already set` : ''}` : `Nothing to copy from ${monthLabel(r.from)}`)
      invalidate()
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })
  const addTag = useMutation({
    mutationFn: () => budgetsApi.createTag({ name: newTag.trim() }),
    onSuccess: (t) => {
      toast.success(t.created ? `Tag “${t.name}” added` : `“${t.name}” already exists`)
      setNewTag('')
      invalidate()
      qc.invalidateQueries({ queryKey: spendKeys.coaTags })
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })

  const kpis = data?.kpis ?? { totalCap: 0, spent: 0, remaining: 0 }
  const chip = (key: string, label: string) => (
    <button
      key={key}
      onClick={() => setBu(key)}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-semibold',
        bu === key ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-dim hover:border-gold/40',
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Budgets</h1>
          <p className="text-sm text-text-dim">
            Tracks <b>operational expenses only</b> — OPEX. Monthly caps per COA tag.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setVarianceOpen(true)}>
            <BarChart3 size={14} /> Variance report
          </Button>
          {perms.canApprove && (
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Import budget
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
          <button className="rounded-lg p-1.5 hover:bg-surface2" onClick={() => setPeriod((p) => shiftMonth(p, -1))} aria-label="Previous month">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[130px] text-center text-sm font-semibold">{monthLabel(period)}</span>
          <button className="rounded-lg p-1.5 hover:bg-surface2" onClick={() => setPeriod((p) => shiftMonth(p, 1))} aria-label="Next month">
            <ChevronRight size={16} />
          </button>
        </div>
        <Button size="sm" variant="outline" disabled={period === monthISO()} onClick={() => setPeriod(monthISO())}>
          Today
        </Button>
        {perms.canApprove && (
          <Button size="sm" variant="outline" isLoading={copyPrev.isPending} onClick={() => copyPrev.mutate()}>
            <Copy size={14} /> Copy from prev
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {chip('all', 'All BUs')}
        {businessUnits.map((b) => chip(b.id, b.code ? `${b.name} (${b.code})` : b.name))}
        {chip('none', 'Workspace-wide')}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: 'Total cap', v: kpis.totalCap },
          { label: `Committed in ${monthLabel(period).split(' ')[0]}`, v: kpis.spent },
          { label: 'Remaining', v: kpis.remaining, tone: kpis.remaining < 0 ? 'text-red' : 'text-green' },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-border bg-card p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{k.label}</div>
            <div className={cn('mt-1 text-2xl font-bold tabular-nums', k.tone)}>{formatNaira(k.v)}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tags…"
            className="h-9 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-sm focus:border-gold focus:outline-none"
          />
        </div>
        {perms.canApprove && (
          <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
            <input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newTag.trim() && addTag.mutate()}
              placeholder="New tag (not in list yet)"
              className="h-9 flex-1 rounded-xl border border-input bg-card px-3 text-sm focus:border-gold focus:outline-none sm:w-56"
            />
            <Button size="sm" disabled={!newTag.trim()} isLoading={addTag.isPending} onClick={() => addTag.mutate()}>
              <Plus size={14} /> Add
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-text-dim">Loading…</div>
        ) : isError ? (
          <div className="py-10 text-center text-sm text-red">{apiErrorMessage(error, 'Could not load budgets')}</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-text-dim">
            {data?.rows.length ? 'No tags match the filter.' : 'No budgeted COA tags. Turn on “Include in budgets” for a category in Settings.'}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <BudgetRow
                key={r.coaTagId}
                row={r}
                canEdit={canEdit}
                editHint={editHint}
                saving={upsert.isPending || remove.isPending}
                onSave={(amount) => upsert.mutate({ coaTagId: r.coaTagId, amount })}
                onRemove={() => r.budgetId && remove.mutate(r.budgetId)}
              />
            ))}
          </div>
        )}
      </div>

      <VarianceModal open={varianceOpen} onClose={() => setVarianceOpen(false)} businessUnits={businessUnits} initialBu={bu} />
      <ImportBudgetWizard open={importOpen} onClose={() => setImportOpen(false)} period={period} bu={bu} businessUnits={businessUnits} />
    </div>
  )
}
