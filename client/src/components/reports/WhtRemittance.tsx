import { AlertTriangle } from 'lucide-react'
import { reportsApi } from '@/lib/api/reports'
import type { ReportQuery, WhtReport } from '@/types/reports'
import { DownloadButton } from './DownloadButton'
import { naira, shortDate } from './format'
import { EmptyState, Panel, TableScroll, td, tdNum, th, thNum } from './primitives'

const ratePct = (r: number) => `${Math.round(r * 10000) / 100}%`

/** WHT Remittance Report (spec §5.6): PAID lines carrying WHT in the period, for FIRS remittance. */
export function WhtRemittance({ wht, query }: { wht: WhtReport; query: ReportQuery }) {
  return (
    <Panel
      title="WHT remittance report"
      meta={
        <span className="tabular-nums">
          {wht.lineCount.toLocaleString()} line{wht.lineCount === 1 ? '' : 's'} · WHT {naira(wht.totals.wht)}
        </span>
      }
      actions={
        <DownloadButton
          label="Download CSV"
          filename={`wht-remittance-${query.period}.csv`}
          fetcher={() => reportsApi.whtCsv(query)}
          disabled={wht.lineCount === 0}
        />
      }
    >
      {wht.vendorsMissingTin > 0 ? (
        <div
          className="mb-3 flex items-start gap-2 rounded-xl border border-purple/30 bg-purple/10 px-3 py-2 text-xs text-foreground"
          title={wht.vendorsMissingTinNames.join(', ')}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple" />
          <span>
            <strong>
              {wht.vendorsMissingTin} vendor{wht.vendorsMissingTin === 1 ? '' : 's'} missing TIN
            </strong>
            {wht.vendorsMissingTinNames.length ? (
              <span className="text-text-dim"> — {wht.vendorsMissingTinNames.slice(0, 5).join(', ')}{wht.vendorsMissingTinNames.length > 5 ? '…' : ''}</span>
            ) : null}
            <span className="text-text-dim">. Add TINs on the Vendors tab before remitting to FIRS.</span>
          </span>
        </div>
      ) : null}
      {wht.lines.length === 0 ? (
        <EmptyState title="No WHT deducted in this period" hint="Only paid lines that carried withholding tax appear here." />
      ) : (
        <TableScroll className="max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border">
                <th className={th}>Date</th>
                <th className={th}>Vendor</th>
                <th className={th}>TIN</th>
                <th className={thNum}>Contract amt</th>
                <th className={thNum}>Rate</th>
                <th className={thNum}>WHT</th>
                <th className={th}>COA</th>
                <th className={th}>Description</th>
              </tr>
            </thead>
            <tbody>
              {wht.lines.map((l) => (
                <tr key={l.batchItemId} className="border-b border-border/60">
                  <td className={td}>{shortDate(l.date)}</td>
                  <td className={td}>{l.vendor}</td>
                  <td className={td}>
                    {l.tin ? (
                      <span className="font-mono text-xs">{l.tin}</span>
                    ) : (
                      <span className="rounded-full bg-purple/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple">No TIN</span>
                    )}
                  </td>
                  <td className={tdNum}>{naira(l.contractAmount)}</td>
                  <td className={tdNum + ' text-text-dim'}>{ratePct(l.rate)}</td>
                  <td className={tdNum + ' font-semibold'}>{naira(l.wht)}</td>
                  <td className={td + ' text-text-dim'}>{l.coa ?? '—'}</td>
                  <td className={td + ' max-w-[280px] truncate'} title={l.description}>
                    {l.description}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-card">
              <tr className="border-t border-border font-semibold">
                <td className={td} colSpan={3}>
                  Total
                </td>
                <td className={tdNum}>{naira(wht.totals.contractAmount)}</td>
                <td className={tdNum} />
                <td className={tdNum}>{naira(wht.totals.wht)}</td>
                <td className={td} colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </TableScroll>
      )}
    </Panel>
  )
}
