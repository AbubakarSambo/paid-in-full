import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatNaira } from '@/lib/money'
import { usePermissions } from '@/lib/permissions'
import { requisitionKeys, requisitionsApi } from '@/lib/api/requisitions'
import { apiErrorMessage } from '@/lib/api/queue'
import type { RequisitionFilter, RequisitionRow } from '@/types/requisitions'
import { Chip, shortDate } from '@/components/queue/common'
import { StatusBadge } from '@/components/requisitions/shared'
import { RequisitionForm } from '@/components/requisitions/RequisitionForm'
import { RequisitionDetailModal } from '@/components/requisitions/RequisitionDetailModal'
import { PushToQueueModal } from '@/components/requisitions/PushToQueueModal'

const FILTERS: { key: RequisitionFilter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'cleared', label: 'Cleared' },
  { key: 'returned', label: 'Returned' },
  { key: 'queued', label: 'Queued' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
]

export default function RequisitionsPage() {
  const perms = usePermissions()
  const canRequest = perms.role !== null && perms.role.toUpperCase() !== 'VIEWER'
  const [filter, setFilter] = useState<RequisitionFilter>('open')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [pushRows, setPushRows] = useState<RequisitionRow[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => setPage(1), [filter, debounced])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: requisitionKeys.list(filter, debounced, page),
    queryFn: () => requisitionsApi.list({ filter, search: debounced, page, limit: 50 }),
  })
  const rows = data?.data ?? []
  const checkedRows = useMemo(() => rows.filter((r) => checked.has(r.id) && r.status === 'PROCUREMENT_CLEARED'), [rows, checked])
  const clearedOnPage = rows.filter((r) => r.status === 'PROCUREMENT_CLEARED')

  const toggle = (id: string, on: boolean) =>
    setChecked((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Requisitions</h1>
          <p className="text-sm text-text-dim">Staff raise requests, procurement clears them, accounts pushes to the payment queue.</p>
        </div>
        <div className="flex gap-2">
          {perms.canApprove && checkedRows.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setPushRows(checkedRows)}>
              <Send size={14} /> Push {checkedRows.length} to queue
            </Button>
          )}
          {canRequest && (
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus size={14} /> New requisition
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold uppercase tracking-wider',
              filter === f.key ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-dim hover:border-gold/40',
            )}
          >
            {f.label}
            <span className="tabular-nums opacity-70">{data?.counts?.[f.key] ?? 0}</span>
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-72">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendor, item, department…"
            className="h-9 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-sm focus:border-gold focus:outline-none"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-surface2 text-[10px] uppercase tracking-wider text-text-dim">
              <tr className="[&>th]:px-3 [&>th]:py-2.5 [&>th]:text-left [&>th]:font-semibold">
                <th className="w-8">
                  {perms.canApprove && clearedOnPage.length > 0 && (
                    <input
                      type="checkbox"
                      className="accent-[var(--gold)]"
                      checked={clearedOnPage.every((r) => checked.has(r.id))}
                      onChange={(e) => clearedOnPage.forEach((r) => toggle(r.id, e.target.checked))}
                    />
                  )}
                </th>
                <th>Date</th>
                <th>Department</th>
                <th>Vendor</th>
                <th>Description</th>
                <th className="!text-right">Total</th>
                <th>Requester</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-text-dim">
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-red">
                    {apiErrorMessage(error, 'Could not load requisitions')}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-text-dim">
                    No requisitions here.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-surface2/50 [&>td]:px-3 [&>td]:py-2.5" onClick={() => setDetailId(r.id)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      {perms.canApprove && r.status === 'PROCUREMENT_CLEARED' && (
                        <input type="checkbox" className="accent-[var(--gold)]" checked={checked.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />
                      )}
                    </td>
                    <td className="whitespace-nowrap text-text-dim">{shortDate(r.date)}</td>
                    <td>{r.department?.name ?? r.departmentName ?? '—'}</td>
                    <td className="max-w-[160px] truncate">
                      {r.vendor?.name ?? r.vendorName ?? '—'}
                      {r.isNewVendor && <span className="ml-1 text-[10px] text-blue">NEW</span>}
                    </td>
                    <td className="max-w-[280px]">
                      <div className="flex items-center gap-1.5">
                        {r.bundleLabel && <Chip tone="gold">{r.bundleLabel}</Chip>}
                        <span className="truncate">{r.description}</span>
                      </div>
                    </td>
                    <td className="text-right font-semibold tabular-nums">{formatNaira(r.total)}</td>
                    <td className="text-text-dim">{r.requesterName ?? '—'}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-text-dim">
            <span>
              Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total} total
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      <RequisitionForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={(first) => first && (setFormOpen(false), setDetailId(first.id))} />
      <RequisitionDetailModal
        id={detailId}
        onClose={() => setDetailId(null)}
        canProcure={perms.canProcure}
        canApprove={perms.canApprove}
        onPush={(r) => {
          setDetailId(null)
          setPushRows([r])
        }}
      />
      <PushToQueueModal
        rows={pushRows}
        onClose={() => setPushRows(null)}
        onDone={() => {
          setPushRows(null)
          setChecked(new Set())
        }}
      />
    </div>
  )
}
