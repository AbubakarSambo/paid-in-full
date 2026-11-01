import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Ban, Download, LayoutGrid, List, MoreHorizontal, Package, Plus, Repeat, Search, Table2, Upload, Zap, UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Popover } from '@/components/shared/Popover'
import { cn } from '@/lib/utils'
import { formatNaira } from '@/lib/money'
import { usePermissions } from '@/lib/permissions'
import { apiErrorMessage, queueApi, queueKeys } from '@/lib/api/queue'
import type { BudgetProjection, QueueBundleEntry, QueueListItem } from '@/types/queue'
import { usePersistentState, useQueueLookups } from '@/components/queue/common'
import { saveBlob } from '@/components/queue/helpers'
import { QueueLaneView } from '@/components/queue/QueueLane'
import { AddQueueItemModal } from '@/components/queue/AddQueueItemModal'
import { ItemDetailsModal } from '@/components/queue/ItemDetailsModal'
import { QuickAddGrid } from '@/components/queue/QuickAddGrid'
import { BundleModal } from '@/components/queue/BundleModal'
import { QueueCsvDialog } from '@/components/queue/QueueCsvDialog'
import { RecurringManager } from '@/components/queue/RecurringManager'
import {
  AddCategoryCard,
  BudgetWarningModal,
  RejectDialog,
  RejectedView,
  SelectionBar,
  SplitDialog,
  type SelectionGroup,
} from '@/components/queue/QueueDialogs'

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

type Confirm =
  | { kind: 'delete'; item: QueueListItem }
  | { kind: 'deleteBundle'; bundle: QueueBundleEntry }
  | null

export default function QueuePage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const perms = usePermissions()
  const { buRequired } = useQueueLookups()

  const [search, setSearch] = useState('')
  const debounced = useDebounced(search)
  const [urgentOnly, setUrgentOnly] = useState(false)
  const [noTinOnly, setNoTinOnly] = useState(false)
  const [view, setView] = usePersistentState<'list' | 'card'>('pif.queue.view', 'list')
  const [collapsed, setCollapsed] = usePersistentState<Record<string, boolean>>('pif.queue.collapsed', {})
  const [quickAdd, setQuickAdd] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [bundleOpen, setBundleOpen] = useState(false)
  const [bundleTarget, setBundleTarget] = useState<QueueBundleEntry | null>(null)
  const [csvOpen, setCsvOpen] = useState(false)
  const [rejectedOpen, setRejectedOpen] = useState(false)
  const [recurringOpen, setRecurringOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [splitItem, setSplitItem] = useState<QueueListItem | null>(null)
  const [rejectItem, setRejectItem] = useState<QueueListItem | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchRefs, setBatchRefs] = useState<Record<string, string>>({})
  const [approving, setApproving] = useState<string | null>(null)
  const [warning, setWarning] = useState<{ group: SelectionGroup; projections: BudgetProjection[] } | null>(null)

  const query = { search: debounced, urgentOnly, noTinOnly }
  const { data, isLoading, isError, error } = useQuery({ queryKey: queueKeys.lanes(query), queryFn: () => queueApi.lanes(query) })

  // Index every visible item by id → lane, so the selection bar can group per category.
  const itemIndex = useMemo(() => {
    const m = new Map<string, { item: QueueListItem; lane: { id: string | null; name: string; color: string } }>()
    for (const lane of data?.lanes ?? []) {
      const l = { id: lane.payCategoryId, name: lane.name, color: lane.color }
      for (const e of lane.entries) {
        const items = e.type === 'item' ? [e.item] : e.items
        for (const it of items) m.set(it.id, { item: it, lane: l })
      }
    }
    return m
  }, [data])

  // Drop selections that disappeared (approved, deleted, filtered out).
  useEffect(() => {
    setSelected((s) => {
      const next = new Set([...s].filter((id) => itemIndex.has(id)))
      return next.size === s.size ? s : next
    })
  }, [itemIndex])

  const groups = useMemo<SelectionGroup[]>(() => {
    const g = new Map<string, SelectionGroup>()
    for (const id of selected) {
      const hit = itemIndex.get(id)
      if (!hit) continue
      const key = hit.lane.id ?? 'none'
      const cur = g.get(key) ?? { payCategoryId: hit.lane.id, name: hit.lane.name, color: hit.lane.color, ids: [], total: 0 }
      cur.ids.push(id)
      cur.total += hit.item.total
      g.set(key, cur)
    }
    return [...g.values()]
  }, [selected, itemIndex])
  const selTotal = groups.reduce((s, g) => s + g.total, 0)

  const onSelect = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      for (const id of ids) (on ? next.add(id) : next.delete(id))
      return next
    })

  const refresh = () => qc.invalidateQueries({ queryKey: queueKeys.all })

  // ─── Approve flow ───────────────────────────────────────────────────────
  const doApprove = async (group: SelectionGroup, budgetOverride: boolean) => {
    const res = await queueApi.approve({
      queueItemIds: group.ids,
      payCategoryId: group.payCategoryId!,
      baseRef: batchRefs[group.payCategoryId!]?.trim() || undefined,
      budgetOverride: budgetOverride || undefined,
    })
    if (res.budgetWarning && res.projections) {
      setWarning({ group, projections: res.projections })
      return
    }
    if (!res.ok) {
      toast.error(res.error ?? 'Could not approve')
      return
    }
    setWarning(null)
    onSelect(group.ids, false)
    setBatchRefs((b) => ({ ...b, [group.payCategoryId!]: '' }))
    if (res.alreadyProcessed) {
      toast.message(`${res.batchRef} — already approved, no duplicate created.`)
    } else {
      toast.success(`${res.batchRef} — ${formatNaira(res.total)} approved. Open Batches to disburse.`, {
        action: { label: 'Open Batches', onClick: () => navigate('/batches') },
      })
    }
    refresh()
    qc.invalidateQueries({ queryKey: ['batches'] })
  }

  const approve = async (group: SelectionGroup) => {
    if (!perms.canApprove || !group.payCategoryId || approving) return
    setApproving(group.payCategoryId)
    try {
      const check = await queueApi.budgetCheck(group.ids, group.payCategoryId)
      if (check.anyOver) {
        setWarning({ group, projections: check.projections })
        return
      }
      await doApprove(group, false)
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setApproving(null)
    }
  }

  const proceedOverride = async () => {
    if (!warning) return
    setApproving(warning.group.payCategoryId)
    try {
      await doApprove(warning.group, true)
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setApproving(null)
    }
  }

  const cancelWarning = () => {
    if (warning) {
      // Audit the cancel (spec §5.2 step 2); fire and forget.
      queueApi.budgetCancel(warning.group.ids, warning.group.payCategoryId ?? undefined).catch(() => undefined)
    }
    setWarning(null)
  }

  // ─── Row actions ────────────────────────────────────────────────────────
  const del = useMutation({
    mutationFn: (c: NonNullable<Confirm>) => (c.kind === 'delete' ? queueApi.remove(c.item.id) : queueApi.deleteBundle(c.bundle.bundleId)),
    onSuccess: (_d, c) => {
      toast.success(c.kind === 'delete' ? 'Item deleted' : 'Bundle deleted')
      setConfirm(null)
      refresh()
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })
  const bundleUrgent = useMutation({
    mutationFn: ({ bundleId, isUrgent }: { bundleId: string; isUrgent: boolean }) => queueApi.bundleUrgent(bundleId, isUrgent),
    onSuccess: (_d, v) => {
      toast.success(v.isUrgent ? 'Bundle marked urgent' : 'Bundle marked not urgent')
      refresh()
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })

  const handlers = {
    onView: (i: QueueListItem) => setDetailId(i.id),
    onSplit: (i: QueueListItem) => setSplitItem(i),
    onReject: (i: QueueListItem) => setRejectItem(i),
    onDelete: (i: QueueListItem) => setConfirm({ kind: 'delete', item: i }),
    onBundleUrgent: (b: QueueBundleEntry, isUrgent: boolean) => bundleUrgent.mutate({ bundleId: b.bundleId, isUrgent }),
    onDeleteBundle: (b: QueueBundleEntry) => setConfirm({ kind: 'deleteBundle', bundle: b }),
    onAddToBundle: (b: QueueBundleEntry) => {
      setBundleTarget(b)
      setBundleOpen(true)
    },
  }

  const downloadTemplate = async () => {
    try {
      saveBlob(await queueApi.csvTemplate(), 'queue-template.csv')
    } catch (e) {
      toast.error(apiErrorMessage(e))
    }
  }

  const menuItem = (icon: React.ReactNode, label: React.ReactNode, onClick: () => void, disabled?: boolean) => (
    <button
      disabled={disabled}
      onClick={() => {
        setMenuOpen(false)
        onClick()
      }}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  )

  const counts = data?.counts ?? { urgent: 0, noTinPhone: 0, rejected: 0 }

  return (
    <div className={cn('space-y-5', selected.size > 0 && 'pb-36')}>
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-text-dim">Payment Queue</div>
        <div className="text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">{formatNaira(data?.grandTotal ?? 0)}</div>
        <div className="text-sm text-text-dim">
          {data?.itemCount ?? 0} item{data?.itemCount === 1 ? '' : 's'} awaiting payment
          {data && (urgentOnly || noTinOnly || debounced) ? ` · showing ${data.visibleCount} (${formatNaira(data.visibleTotal)})` : ''}
        </div>
        {!perms.canPost && <div className="mt-1 text-xs text-text-muted">Read-only — Poster role required to edit.</div>}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendor, description…"
            className="h-10 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-sm focus:border-gold focus:outline-none"
          />
        </div>
        <button
          onClick={() => setUrgentOnly((v) => !v)}
          className={cn(
            'inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold uppercase tracking-wider',
            urgentOnly ? 'border-orange bg-orange/15 text-orange' : 'border-border text-text-dim hover:border-orange/50',
          )}
        >
          <Zap size={13} /> Urgent <span className="tabular-nums">{counts.urgent}</span>
        </button>
        <button
          onClick={() => setNoTinOnly((v) => !v)}
          title="Vendors missing a TIN or phone — chase these before paying"
          className={cn(
            'inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold uppercase tracking-wider',
            noTinOnly ? 'border-purple bg-purple/15 text-purple' : 'border-border text-text-dim hover:border-purple/50',
          )}
        >
          <UserX size={13} /> No TIN <span className="tabular-nums">{counts.noTinPhone}</span>
        </button>
        <Button size="sm" variant="outline" className="h-10" onClick={() => setRecurringOpen(true)}>
          <Repeat size={14} /> Recurring
        </Button>
        {perms.canPost && (
          <Button size="sm" className="h-10" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Add Item
          </Button>
        )}
        <div className="w-10">
          <Popover
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            align="right"
            className="w-60"
            trigger={
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-text-dim hover:text-foreground"
                aria-label="More"
              >
                <MoreHorizontal size={16} />
              </button>
            }
          >
            <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">View</div>
            <div className="mx-2 mb-1 flex gap-1 rounded-lg bg-surface2 p-1">
              {(['list', 'card'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn('flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-xs font-semibold', view === v ? 'bg-card text-gold' : 'text-text-dim')}
                >
                  {v === 'list' ? <List size={12} /> : <LayoutGrid size={12} />} {v === 'list' ? 'List' : 'Card'}
                </button>
              ))}
            </div>
            {menuItem(<Table2 size={14} />, 'Quick add', () => setQuickAdd(true), !perms.canPost)}
            {menuItem(<Package size={14} />, 'New bundle', () => (setBundleTarget(null), setBundleOpen(true)), !perms.canPost)}
            {menuItem(<Upload size={14} />, 'Upload CSV', () => setCsvOpen(true), !perms.canPost)}
            {menuItem(<Download size={14} />, 'CSV template', downloadTemplate)}
            {menuItem(
              <Ban size={14} />,
              <span className="flex flex-1 justify-between">
                Rejected <span className="tabular-nums text-text-muted">{counts.rejected}</span>
              </span>,
              () => setRejectedOpen(true),
            )}
          </Popover>
        </div>
      </div>

      {quickAdd && perms.canPost && <QuickAddGrid onClose={() => setQuickAdd(false)} onUploadCsv={() => setCsvOpen(true)} />}

      {/* Lanes */}
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-card" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-red/30 bg-red/5 p-6 text-sm text-red">{apiErrorMessage(error, 'Could not load the queue')}</div>
      ) : (
        <div className="space-y-3">
          {(data?.lanes ?? []).map((lane) => {
            const key = lane.payCategoryId ?? 'uncategorised'
            return (
              <QueueLaneView
                key={key}
                lane={lane}
                collapsed={!!collapsed[key]}
                onToggleCollapse={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
                view={view}
                selected={selected}
                onSelect={onSelect}
                canPost={perms.canPost}
                canApprove={perms.canApprove}
                {...handlers}
              />
            )
          })}
          {data && data.lanes.length === 0 && (
            <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-text-dim">
              No payment categories yet. Add one to start queueing bills.
            </div>
          )}
          {perms.isAdmin && <AddCategoryCard />}
        </div>
      )}

      <SelectionBar
        groups={groups}
        total={selTotal}
        count={selected.size}
        canApprove={perms.canApprove}
        batchRefs={batchRefs}
        onBatchRef={(id, v) => setBatchRefs((b) => ({ ...b, [id]: v }))}
        onApprove={approve}
        approvingId={approving}
        onClear={() => setSelected(new Set())}
      />

      <AddQueueItemModal open={addOpen} onClose={() => setAddOpen(false)} buRequired={buRequired} canApprove={perms.canApprove} />
      <ItemDetailsModal
        itemId={detailId}
        onClose={() => setDetailId(null)}
        canPost={perms.canPost}
        canApprove={perms.canApprove}
        buRequired={buRequired}
      />
      <BundleModal
        open={bundleOpen}
        bundle={bundleTarget}
        onClose={() => {
          setBundleOpen(false)
          setBundleTarget(null)
        }}
        buRequired={buRequired}
        canApprove={perms.canApprove}
      />
      <QueueCsvDialog open={csvOpen} onClose={() => setCsvOpen(false)} />
      <RejectedView open={rejectedOpen} onClose={() => setRejectedOpen(false)} canApprove={perms.canApprove} />
      <RecurringManager open={recurringOpen} onClose={() => setRecurringOpen(false)} canPost={perms.canPost} />
      <SplitDialog item={splitItem} onClose={() => setSplitItem(null)} />
      <RejectDialog item={rejectItem} onClose={() => setRejectItem(null)} />
      <BudgetWarningModal projections={warning?.projections ?? null} busy={!!approving} onCancel={cancelWarning} onProceed={proceedOverride} />
      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && del.mutate(confirm)}
        isLoading={del.isPending}
        isDangerous
        title={confirm?.kind === 'deleteBundle' ? 'Delete entire bundle?' : 'Delete this item?'}
        description={
          confirm?.kind === 'deleteBundle'
            ? `All ${confirm.bundle.itemCount} pending lines in “${confirm.bundle.bundleLabel ?? 'bundle'}” will be permanently deleted. Use Cancel (reject) instead if it just won't be paid.`
            : 'Delete is for genuine mistakes and cannot be undone. Use Cancel (reject) if it just won’t be paid.'
        }
        confirmText="Delete"
      />
    </div>
  )
}
