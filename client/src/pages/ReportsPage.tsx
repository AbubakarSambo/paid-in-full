import { useState } from 'react'
import { reportsApi } from '@/lib/api/reports'
import type { ReportPeriod, ReportQuery } from '@/types/reports'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Chip, MicroLabel } from '@/components/reports/primitives'
import { DownloadButton } from '@/components/reports/DownloadButton'
import { MoneyOutTab } from '@/components/reports/MoneyOutTab'
import { SalesTab } from '@/components/reports/SalesTab'
import { VendorDebtTab } from '@/components/reports/VendorDebtTab'

type SubTab = 'money-out' | 'sales' | 'vendor-debt'

const PERIODS: { id: ReportPeriod; label: string }[] = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
]

const TABS: { id: SubTab; label: string }[] = [
  { id: 'money-out', label: 'Money out' },
  { id: 'sales', label: 'Sales' },
  { id: 'vendor-debt', label: 'Vendor debt' },
]

const pad = (n: number) => String(n).padStart(2, '0')
const today = new Date()
const thisMonth = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`
const firstOfMonth = `${thisMonth}-01`
const todayYmd = `${thisMonth}-${pad(today.getDate())}`

export default function ReportsPage() {
  const [tab, setTab] = useState<SubTab>('money-out')
  const [period, setPeriod] = useState<ReportPeriod>('this_month')
  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo] = useState(todayYmd)
  const [asOf, setAsOf] = useState(thisMonth)

  const customInvalid = period === 'custom' && !!from && !!to && from > to
  // Hold the last valid query while a custom range is being edited into an invalid state.
  const query: ReportQuery = period === 'custom' ? { period, from: customInvalid ? undefined : from, to: customInvalid ? undefined : to } : { period }
  const stamp = period === 'custom' ? `${from || 'start'}_${to || 'now'}` : period

  const exports =
    tab === 'money-out' ? (
      <>
        <DownloadButton label="CSV" filename={`money-out-${stamp}.csv`} fetcher={() => reportsApi.moneyOutCsv(query)} />
        <DownloadButton label="PDF" filename={`money-out-${stamp}.pdf`} fetcher={() => reportsApi.moneyOutPdf(query)} />
      </>
    ) : tab === 'sales' ? (
      <DownloadButton label="Sales CSV" filename={`sales-${stamp}.csv`} fetcher={() => reportsApi.salesCsv(query)} />
    ) : (
      <>
        <DownloadButton label="CSV" filename={`vendor-debt-${asOf}.csv`} fetcher={() => reportsApi.vendorDebtCsv(asOf)} />
        <DownloadButton label="PDF" filename={`vendor-debt-${asOf}.pdf`} fetcher={() => reportsApi.vendorDebtPdf(asOf)} />
      </>
    )

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <MicroLabel>Reports</MicroLabel>
          <h1 className="font-display text-2xl font-bold">Reports</h1>
        </div>
        <div className="flex flex-wrap gap-2">{exports}</div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Report">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              tab === t.id ? 'border-gold text-foreground' : 'border-transparent text-text-dim hover:text-foreground',
            )}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'vendor-debt' ? (
        <div className="flex flex-wrap items-center gap-2">
          <MicroLabel>As at month end</MicroLabel>
          <Input
            type="month"
            value={asOf}
            max={thisMonth}
            onChange={(e) => setAsOf(e.target.value || thisMonth)}
            className="h-9 w-[170px]"
            aria-label="As at month end"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {PERIODS.map((p) => (
              <Chip key={p.id} active={period === p.id} onClick={() => setPeriod(p.id)}>
                {p.label}
              </Chip>
            ))}
          </div>
          {period === 'custom' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[160px]" aria-label="From" />
              <span className="text-xs text-text-dim">to</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[160px]" aria-label="To" />
              {customInvalid ? <span className="text-xs text-red">“From” must be on or before “to”</span> : null}
            </div>
          ) : null}
        </div>
      )}

      {tab === 'money-out' ? <MoneyOutTab query={query} /> : null}
      {tab === 'sales' ? <SalesTab query={query} /> : null}
      {tab === 'vendor-debt' ? <VendorDebtTab asOf={asOf} /> : null}
    </div>
  )
}
