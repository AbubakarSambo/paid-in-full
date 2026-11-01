import { useQuery } from '@tanstack/react-query'
import { Scale } from 'lucide-react'
import { reportsApi } from '@/lib/api/reports'
import { naira, shortDate } from './format'
import { EmptyState, KpiSkeletonRow, KpiTile, Panel, Skeleton, TableScroll, td, tdNum, th, thNum } from './primitives'

export function VendorDebtTab({ asOf }: { asOf: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', 'vendor-debt', asOf],
    queryFn: () => reportsApi.vendorDebt(asOf),
  })

  if (isLoading)
    return (
      <div className="space-y-4" aria-busy>
        <KpiSkeletonRow count={4} />
        <Skeleton className="h-[320px] rounded-2xl" />
      </div>
    )
  if (isError || !data)
    return (
      <Panel title="Vendor debt">
        <EmptyState title="Could not load vendor debt" hint="Check your connection and try again." />
      </Panel>
    )

  const { totals } = data
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Total owed" value={naira(totals.totalOwed)} tone="gold" sub={`As at ${shortDate(data.asOf)}`} />
        <KpiTile label="Posted unpaid" value={naira(totals.postedUnpaid)} sub="In batches, not yet paid" />
        <KpiTile label="In queue" value={naira(totals.inQueue)} sub="Not yet batched" />
        <KpiTile label="Vendors" value={data.rows.length.toLocaleString()} sub={`${totals.lines} line${totals.lines === 1 ? '' : 's'}`} />
      </div>

      <Panel title={`Vendor debt as at ${shortDate(data.asOf)}`} meta="Largest balance first">
        {data.rows.length === 0 ? (
          <EmptyState icon={<Scale className="h-6 w-6" />} title="No vendor is owed anything at this month end" />
        ) : (
          <TableScroll className="max-h-[560px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border">
                  <th className={th}>Vendor</th>
                  <th className={thNum}>Lines</th>
                  <th className={th}>Oldest item</th>
                  <th className={thNum}>Posted unpaid</th>
                  <th className={thNum}>In queue</th>
                  <th className={thNum}>Total owed</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.vendorId} className="border-b border-border/60">
                    <td className={td}>{r.vendor}</td>
                    <td className={tdNum}>{r.lines}</td>
                    <td className={td + ' text-text-dim'}>{shortDate(r.oldestItem)}</td>
                    <td className={tdNum}>{naira(r.postedUnpaid)}</td>
                    <td className={tdNum}>{naira(r.inQueue)}</td>
                    <td className={tdNum + ' font-semibold'}>{naira(r.totalOwed)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-card">
                <tr className="border-t border-border font-semibold">
                  <td className={td}>Total</td>
                  <td className={tdNum}>{totals.lines}</td>
                  <td className={td} />
                  <td className={tdNum}>{naira(totals.postedUnpaid)}</td>
                  <td className={tdNum}>{naira(totals.inQueue)}</td>
                  <td className={tdNum}>{naira(totals.totalOwed)}</td>
                </tr>
              </tfoot>
            </table>
          </TableScroll>
        )}
      </Panel>
    </div>
  )
}
