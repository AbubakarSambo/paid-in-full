import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { sheetsApi } from '@/lib/api/sheets'
import { usePermissions } from '@/lib/permissions'
import type { ReconStatus } from '@/types/reports'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { errorMessageSync, naira } from '@/components/reports/format'
import { Chip, EmptyState, Skeleton, StatusPill, TableScroll, td, tdNum, th, thNum } from '@/components/reports/primitives'
import { Notice, ReadOnlyNote, SettingsCard } from '@/components/reports/SheetsShared'

const STATUSES: ReconStatus[] = ['Matched', 'Fixable', 'Mismatch', 'No BU in app', 'Not in app']

export default function SheetRecon() {
  const { isAdmin } = usePermissions()
  const [filter, setFilter] = useState<ReconStatus | 'All'>('All')
  const [confirmFill, setConfirmFill] = useState(false)

  // Reading the sheet is slow and hits Google, so it only runs when asked.
  const recon = useQuery({ queryKey: ['sheets', 'recon'], queryFn: sheetsApi.recon, enabled: false, retry: false })
  const fill = useMutation({
    mutationFn: sheetsApi.reconFill,
    onSuccess: (r) => {
      toast.success(r.filled ? `Filled BU/BU Head on ${r.filled} row${r.filled === 1 ? '' : 's'}${r.mock ? ' (mock mode)' : ''}` : r.message ?? 'No fixable rows')
      setConfirmFill(false)
      recon.refetch()
    },
    onError: (e) => toast.error(errorMessageSync(e, 'Could not fill the sheet')),
  })

  const data = recon.data
  const rows = useMemo(() => (data ? (filter === 'All' ? data.rows : data.rows.filter((r) => r.status === filter)) : []), [data, filter])
  const fixable = data?.summary.Fixable ?? 0

  return (
    <SettingsCard
      id="sheet-recon"
      title="Sheet Recon"
      description="Reads the mastersheet and compares each row with the app's lines (batch ref, vendor, amount, BU and BU Head)."
    >
      {!isAdmin ? (
        <ReadOnlyNote />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => recon.refetch()} isLoading={recon.isFetching}>
              {recon.isFetching ? null : <RefreshCw className="h-3.5 w-3.5" />}
              {data ? 'Re-run recon' : 'Run recon'}
            </Button>
            {data ? (
              <Button size="sm" onClick={() => setConfirmFill(true)} disabled={fixable === 0} title={fixable === 0 ? 'No fixable rows' : undefined}>
                Fill BU/BU Head into sheet{fixable ? ` (${fixable})` : ''}
              </Button>
            ) : null}
          </div>

          {recon.isError ? (
            <Notice tone="error">
              {errorMessageSync(recon.error, 'Recon failed')}. Check that Google Sheets sync — Batches has a sheet (or reconciliation sheet) configured.
            </Notice>
          ) : null}

          {recon.isFetching && !data ? <Skeleton className="h-40" /> : null}

          {data ? (
            <>
              <p className="text-xs text-text-dim">
                {data.sheetRows} sheet row{data.sheetRows === 1 ? '' : 's'} in “{data.tab}” ·{' '}
                {data.appLinesNotInSheet} app line{data.appLinesNotInSheet === 1 ? '' : 's'} not in the sheet
              </p>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
                <Chip active={filter === 'All'} onClick={() => setFilter('All')}>
                  All · {data.rows.length}
                </Chip>
                {STATUSES.map((s) => (
                  <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
                    {s} · {data.summary[s] ?? 0}
                  </Chip>
                ))}
              </div>
              {rows.length === 0 ? (
                <EmptyState title={filter === 'All' ? 'The sheet has no batch rows' : `No ${filter} rows`} />
              ) : (
                <TableScroll className="max-h-[480px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border">
                        <th className={thNum}>Row</th>
                        <th className={th}>Batch ref</th>
                        <th className={th}>Vendor</th>
                        <th className={thNum}>Gross</th>
                        <th className={th}>Sheet BU / Head</th>
                        <th className={th}>App BU / Head</th>
                        <th className={th}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.rowNumber} className="border-b border-border/60">
                          <td className={tdNum + ' text-text-dim'}>{r.rowNumber}</td>
                          <td className={td + ' font-mono text-xs'}>{r.batchRef}</td>
                          <td className={td}>{r.vendor}</td>
                          <td className={tdNum}>{naira(r.gross)}</td>
                          <td className={td}>
                            {r.sheetBu || <span className="text-text-muted">—</span>}
                            <span className="text-text-dim"> / {r.sheetBuHead || '—'}</span>
                          </td>
                          <td className={td}>
                            {r.appBu ?? <span className="text-text-muted">—</span>}
                            <span className="text-text-dim"> / {r.appBuHead ?? '—'}</span>
                          </td>
                          <td className={td}>
                            <StatusPill status={r.status} />
                            {r.reason ? <span className="ml-2 text-xs text-text-dim">{r.reason}</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </>
          ) : null}
        </>
      )}

      <ConfirmDialog
        isOpen={confirmFill}
        onClose={() => setConfirmFill(false)}
        onConfirm={() => fill.mutate()}
        isLoading={fill.isPending}
        title="Fill BU/BU Head into the sheet?"
        description={`Writes the app's Business Unit and BU Head into ${fixable} fixable row${fixable === 1 ? '' : 's'} of the mastersheet. Other rows are not touched.`}
        confirmText="Fill sheet"
      />
    </SettingsCard>
  )
}
