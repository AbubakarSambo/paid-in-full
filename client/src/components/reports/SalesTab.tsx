import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps, type TooltipValueType } from 'recharts'
import { Receipt } from 'lucide-react'
import { reportsApi } from '@/lib/api/reports'
import type { ReportQuery, SalesReport } from '@/types/reports'
import { monthLabel, naira, nairaShort, SERIES_PRIMARY, SERIES_SECONDARY, shortDate } from './format'
import {
  axisTick,
  ChartTooltip,
  EmptyState,
  gridStroke,
  KpiSkeletonRow,
  KpiTile,
  Legend,
  Panel,
  Skeleton,
  StatusPill,
  TableScroll,
  td,
  tdNum,
  th,
  thNum,
} from './primitives'

type Tip = TooltipContentProps<TooltipValueType, string | number>

export function SalesTab({ query }: { query: ReportQuery }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', 'sales', query],
    queryFn: () => reportsApi.sales(query),
  })

  if (isLoading)
    return (
      <div className="space-y-4" aria-busy>
        <KpiSkeletonRow count={5} />
        <Skeleton className="h-[320px] rounded-2xl" />
        <Skeleton className="h-[220px] rounded-2xl" />
      </div>
    )
  if (isError || !data)
    return (
      <Panel title="Sales">
        <EmptyState title="Could not load the sales report" hint="Sales needs the Invoices module; check your access and try again." />
      </Panel>
    )

  const { kpis } = data
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiTile label="Invoiced" value={naira(kpis.invoiced)} tone="gold" sub={`${kpis.count} invoice${kpis.count === 1 ? '' : 's'}`} />
        <KpiTile label="Collected" value={naira(kpis.collected)} tone="green" />
        <KpiTile label="Outstanding" value={naira(kpis.outstanding)} tone={kpis.outstanding > 0 ? 'orange' : undefined} />
        <KpiTile label="VAT" value={naira(kpis.vat)} />
        <KpiTile label="WHT" value={naira(kpis.wht)} />
      </div>

      {kpis.count === 0 ? (
        <Panel title="No invoices in this period">
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="Nothing invoiced in this period" hint="Drafts and voided invoices are not counted." />
        </Panel>
      ) : (
        <>
          <ByMonthChart data={data} />
          <ByCustomer data={data} />
          <InvoiceList data={data} />
        </>
      )}
    </div>
  )
}

function ByMonthChart({ data }: { data: SalesReport }) {
  const rows = data.byMonth.map((m) => ({ ...m, label: monthLabel(m.month) }))
  const series = [
    { key: 'invoiced' as const, name: 'Invoiced', color: SERIES_PRIMARY },
    { key: 'collected' as const, name: 'Collected', color: SERIES_SECONDARY },
  ]
  return (
    <Panel title="Invoiced vs collected by month" actions={<Legend items={series} />}>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke={gridStroke} />
            <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={nairaShort} width={60} />
            <Tooltip
              cursor={{ fill: 'var(--surface2)' }}
              content={({ active, payload, label }: Tip) => (
                <ChartTooltip
                  active={active}
                  label={label}
                  rows={series.map((s) => ({ name: s.name, color: s.color, value: Number(payload?.[0]?.payload?.[s.key] ?? 0) }))}
                />
              )}
            />
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}

function ByCustomer({ data }: { data: SalesReport }) {
  return (
    <Panel title="By customer" meta={`${data.byCustomer.length} customer${data.byCustomer.length === 1 ? '' : 's'}`}>
      <TableScroll>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={th}>Customer</th>
              <th className={thNum}>Invoices</th>
              <th className={thNum}>Invoiced</th>
              <th className={thNum}>Collected</th>
              <th className={thNum}>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {data.byCustomer.map((c) => (
              <tr key={c.customerId} className="border-b border-border/60">
                <td className={td}>{c.customer}</td>
                <td className={tdNum}>{c.invoices}</td>
                <td className={tdNum + ' font-semibold'}>{naira(c.invoiced)}</td>
                <td className={tdNum}>{naira(c.collected)}</td>
                <td className={tdNum + (c.outstanding > 0 ? ' text-orange' : ' text-text-dim')}>{naira(c.outstanding)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className={td}>Total</td>
              <td className={tdNum}>{data.kpis.count}</td>
              <td className={tdNum}>{naira(data.kpis.invoiced)}</td>
              <td className={tdNum}>{naira(data.kpis.collected)}</td>
              <td className={tdNum}>{naira(data.kpis.outstanding)}</td>
            </tr>
          </tfoot>
        </table>
      </TableScroll>
    </Panel>
  )
}

function InvoiceList({ data }: { data: SalesReport }) {
  return (
    <Panel title="Invoices" meta={`${data.invoices.length} in period`}>
      <TableScroll className="max-h-[480px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border">
              <th className={th}>Invoice</th>
              <th className={th}>Customer</th>
              <th className={th}>Issued</th>
              <th className={th}>Due</th>
              <th className={th}>Status</th>
              <th className={thNum}>Total</th>
              <th className={thNum}>VAT</th>
              <th className={thNum}>WHT</th>
              <th className={thNum}>Paid</th>
              <th className={thNum}>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {data.invoices.map((i) => (
              <tr key={i.id} className="border-b border-border/60">
                <td className={td + ' font-mono text-xs'}>{i.invoiceNumber ?? '—'}</td>
                <td className={td}>{i.customer}</td>
                <td className={td}>{shortDate(i.issueDate)}</td>
                <td className={td + ' text-text-dim'}>{shortDate(i.dueDate)}</td>
                <td className={td}>
                  <StatusPill status={i.status} />
                </td>
                <td className={tdNum + ' font-semibold'}>{naira(i.total)}</td>
                <td className={tdNum + ' text-text-dim'}>{naira(i.vat)}</td>
                <td className={tdNum + ' text-text-dim'}>{naira(i.wht)}</td>
                <td className={tdNum}>{naira(i.paid)}</td>
                <td className={tdNum + (i.outstanding > 0 ? ' text-orange' : ' text-text-dim')}>{naira(i.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Panel>
  )
}
