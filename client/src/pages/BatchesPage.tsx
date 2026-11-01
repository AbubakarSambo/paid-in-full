import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, FileArchive, LayoutGrid, List, Loader2, NotebookPen, Receipt, Search, Send, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/lib/permissions'
import { batchKeys, batchesApi, inflightStore, type InflightDisbursement } from '@/lib/api/batches'
import type { BatchFilter, BatchSummary } from '@/types/batches'
import { BatchCard, type BatchPerms } from '@/components/batches/BatchCard'
import { DisburseModal } from '@/components/batches/DisburseModal'
import { ReconcileStatementDialog } from '@/components/batches/ReconcileStatementDialog'
import { ManualExpenseDialog } from '@/components/batches/ManualExpenseDialog'
import { MicroLabel, naira, withToast } from '@/components/batches/shared'

type View = 'list' | 'cards'
const VIEW_KEY = 'pif:batches:view'

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'list'
  } catch {
    return 'list'
  }
}

export default function BatchesPage() {
  const perms = usePermissions()
  const bperms: BatchPerms = { canApprove: perms.canApprove, canPay: perms.canPay, isAdmin: perms.isAdmin }

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  const [filter, setFilter] = useState<BatchFilter>('all')
  const [view, setViewState] = useState<View>(readView)
  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* ignore */
    }
  }
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [paidOpen, setPaidOpen] = useState(false)
  const [reconcileOpen, setReconcileOpen] = useState(false)
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [disburse, setDisburse] = useState<{ batchId: string; batchRef: string; resume?: string } | null>(null)

  // Resume a disbursement whose outcome we never received (reload / dropped connection).
  useEffect(() => {
    const pending: InflightDisbursement | null = inflightStore.first()
    if (pending) setDisburse({ batchId: pending.batchId, batchRef: pending.batchRef, resume: pending.clientRequestId })
  }, [])

  const q = useQuery({
    queryKey: batchKeys.list(debounced, filter),
    queryFn: () => batchesApi.list({ search: debounced, status: filter }),
    refetchInterval: (query) => ((query.state.data?.kpis.inFlight.transfers ?? 0) > 0 ? 15_000 : false),
  })
  const data = q.data
  const k = data?.kpis

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const renderBatches = (list: BatchSummary[]) => (
    <div className={cn(view === 'cards' ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3' : 'space-y-3')}>
      {list.map((b) => (
        <BatchCard
          key={b.id}
          batch={b}
          perms={bperms}
          compact={view === 'cards'}
          expanded={expanded.has(b.id)}
          onToggle={() => toggle(b.id)}
          onDisburse={() => {
            const pending = inflightStore.get(b.id)
            setDisburse({ batchId: b.id, batchRef: b.batchRef, resume: pending?.clientRequestId })
          }}
        />
      ))}
    </div>
  )

  const chips: Array<{ key: BatchFilter; label: string; count?: number }> = [
    { key: 'all', label: 'All', count: data?.counts.all },
    { key: 'ready', label: 'Ready', count: data?.counts.ready },
    { key: 'paid', label: 'Paid', count: data?.counts.paid },
  ]
  const showPaid = filter === 'paid' || paidOpen

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Batches</h1>
          <p className="text-sm text-muted-foreground">Approved bills, grouped by category and ready to disburse.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {perms.canPay && (
            <Button variant="outline" size="sm" onClick={() => setReconcileOpen(true)}>
              <Receipt size={14} /> Reconcile statement
            </Button>
          )}
          {perms.canApprove && (
            <Button variant="outline" size="sm" onClick={() => setExpenseOpen(true)}>
              <NotebookPen size={14} /> Log expense
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            isLoading={exporting}
            onClick={async () => {
              setExporting(true)
              await withToast(() => batchesApi.exportAllReceipts())
              setExporting(false)
            }}
          >
            <FileArchive size={14} /> Export receipts
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Wallet} label="Ready to pay" value={k ? naira(k.readyToPay.amount) : '—'} sub={k ? `${k.readyToPay.lines} lines · ${k.readyToPay.batches} batches` : ''} />
        <Kpi icon={Send} label="In flight" value={k ? naira(k.inFlight.amount) : '—'} sub={k ? `${k.inFlight.transfers} transfer${k.inFlight.transfers === 1 ? '' : 's'} processing` : ''} tone={k && k.inFlight.transfers > 0 ? 'text-purple' : undefined} />
        <Kpi icon={Receipt} label="Paid this week" value={k ? naira(k.paidThisWeek.amount) : '—'} sub={k ? `${k.paidThisWeek.lines} lines` : ''} tone="text-green" />
        <Kpi
          icon={AlertTriangle}
          label="Failed lines"
          value={k ? `${k.failedLines.lines}` : '—'}
          sub={k ? (k.failedLines.lines ? `${naira(k.failedLines.amount)} needs attention` : 'Nothing needs attention') : ''}
          tone={k && k.failedLines.lines > 0 ? 'text-red' : undefined}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by ref, vendor, category or status"
            className="h-10 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-[16px] focus:border-gold focus:outline-none sm:text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors',
                filter === c.key ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-dim hover:text-foreground',
              )}
            >
              {c.label} · {c.count ?? '–'}
            </button>
          ))}
          <div className="ml-auto flex rounded-xl border border-border p-0.5 sm:ml-2">
            <button onClick={() => setView('list')} className={cn('rounded-lg p-1.5', view === 'list' ? 'bg-secondary text-gold' : 'text-text-dim')} aria-label="List view">
              <List size={16} />
            </button>
            <button onClick={() => setView('cards')} className={cn('rounded-lg p-1.5', view === 'cards' ? 'bg-secondary text-gold' : 'text-text-dim')} aria-label="Cards view">
              <LayoutGrid size={16} />
            </button>
          </div>
        </div>
      </div>

      {q.isLoading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-text-dim">
          <Loader2 size={16} className="animate-spin" /> Loading batches…
        </div>
      )}
      {q.isError && <p className="py-12 text-center text-sm text-red">Couldn't load batches. Try again.</p>}

      {data && filter !== 'paid' && (
        data.batches.length ? (
          renderBatches(data.batches)
        ) : (
          <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-text-dim">
            {debounced || filter !== 'all' ? 'No batches match this filter.' : 'No open batches. Approve items in the Queue to create one.'}
          </div>
        )
      )}

      {data && data.paidBatches.length > 0 && (
        <div className="space-y-3">
          {filter !== 'paid' && (
            <button onClick={() => setPaidOpen((o) => !o)} className="flex items-center gap-2" aria-expanded={showPaid}>
              <MicroLabel>Paid batches ({data.paidBatches.length})</MicroLabel>
              <ChevronDown size={14} className={cn('text-text-dim transition-transform', showPaid && 'rotate-180')} />
            </button>
          )}
          {showPaid && renderBatches(data.paidBatches)}
        </div>
      )}
      {data && filter === 'paid' && !data.paidBatches.length && (
        <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-text-dim">No paid batches yet.</div>
      )}

      {disburse && (
        <DisburseModal
          key={`${disburse.batchId}:${disburse.resume ?? 'new'}`}
          batchId={disburse.batchId}
          batchRef={disburse.batchRef}
          resumeClientRequestId={disburse.resume}
          onClose={() => setDisburse(null)}
        />
      )}
      {reconcileOpen && <ReconcileStatementDialog onClose={() => setReconcileOpen(false)} />}
      {expenseOpen && <ManualExpenseDialog onClose={() => setExpenseOpen(false)} />}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: typeof Wallet; label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <MicroLabel>{label}</MicroLabel>
        <Icon size={15} className="text-text-dim" />
      </div>
      <p className={cn('mt-2 font-display text-xl font-bold tabular-nums sm:text-2xl', tone)}>{value}</p>
      <p className="mt-0.5 truncate text-xs text-text-dim">{sub}</p>
    </div>
  )
}
