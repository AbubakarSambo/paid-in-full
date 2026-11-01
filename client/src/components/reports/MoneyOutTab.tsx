import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from 'recharts'
import { reportsApi } from '@/lib/api/reports'
import type { MoneyOutReport, NamedTotal, ReportQuery } from '@/types/reports'
import { buildCategoryColors, monthLabel, naira, nairaShort, pct, SERIES_PRIMARY, SERIES_SECONDARY, shortDate } from './format'
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
  Swatch,
  TableScroll,
  td,
  tdNum,
  th,
  thNum,
} from './primitives'
import { WhtRemittance } from './WhtRemittance'

type Tip = TooltipContentProps<TooltipValueType, string | number>

const truncate = (s: string, n = 18) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const barHeight = (rows: number) => Math.max(140, rows * 34 + 24)
const COA_CHART_LIMIT = 12

export function MoneyOutTab({ query }: { query: ReportQuery }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', 'money-out', query],
    queryFn: () => reportsApi.moneyOut(query),
  })
  const { data: payCategories } = useQuery({
    queryKey: ['pay-categories', 'report-colors'],
    queryFn: reportsApi.payCategories,
    staleTime: 5 * 60_000,
  })

  const colorOf = useMemo(() => buildCategoryColors(data?.categories ?? [], payCategories), [data?.categories, payCategories])

  if (isLoading) return <MoneyOutSkeleton />
  if (isError || !data)
    return (
      <Panel title="Money out">
        <EmptyState title="Could not load the report" hint="Check your connection and try again." />
      </Panel>
    )

  const { kpis } = data
  const empty = kpis.items === 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Total spend" value={naira(kpis.totalSpend)} tone="gold" sub={data.period.label} />
        <KpiTile
          label="Paid"
          value={naira(kpis.paid)}
          sub={kpis.outstanding > 0 ? `${naira(kpis.outstanding)} outstanding` : 'Nothing outstanding'}
        />
        <KpiTile label="Batches" value={kpis.batches.toLocaleString()} />
        <KpiTile label="Items" value={kpis.items.toLocaleString()} />
      </div>

      {empty ? (
        <Panel title="No spend in this period">
          <EmptyState title="Nothing was batched in this period" hint="Pick a wider period, or add items to a batch from the queue." />
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <TrendChart data={data} className="lg:col-span-2" />
            <CategoryDonut categories={data.categories} total={kpis.totalSpend} colorOf={colorOf} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <HorizontalBars
              title="Spend by category"
              rows={data.categories}
              colorOf={(r) => colorOf(r.label)}
            />
            <HorizontalBars
              title="Top vendors"
              meta={`${data.topVendors.uniqueCount.toLocaleString()} unique`}
              rows={data.topVendors.rows}
              colorOf={() => SERIES_PRIMARY}
            />
          </div>

          <BusinessUnits data={data} />
          <CoaSection data={data} colorOf={colorOf} />
          <MonthlyByCategory data={data} colorOf={colorOf} />
        </>
      )}

      <WhtRemittance wht={data.wht} query={query} />
      <BatchHistory rows={data.batchHistory} />
    </div>
  )
}

function MoneyOutSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <KpiSkeletonRow count={4} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[320px] rounded-2xl lg:col-span-2" />
        <Skeleton className="h-[320px] rounded-2xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[260px] rounded-2xl" />
        <Skeleton className="h-[260px] rounded-2xl" />
      </div>
      <Skeleton className="h-[220px] rounded-2xl" />
    </div>
  )
}

// ─── Monthly trend ────────────────────────────────────────────────────────────

function TrendChart({ data, className }: { data: MoneyOutReport; className?: string }) {
  const rows = data.monthlyTrend.map((m) => ({ ...m, label: monthLabel(m.month) }))
  const series = [
    { key: 'total' as const, name: 'Total spend', color: SERIES_PRIMARY },
    { key: 'paid' as const, name: 'Paid', color: SERIES_SECONDARY },
  ]
  return (
    <Panel title="Monthly spend trend" meta={`${rows.length} month${rows.length === 1 ? '' : 's'}`} actions={<Legend items={series} />} className={className}>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={gridStroke} strokeDasharray="0" />
            <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} minTickGap={12} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={nairaShort} width={60} />
            <Tooltip
              cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1 }}
              content={({ active, payload, label }: Tip) => (
                <ChartTooltip
                  active={active}
                  label={label}
                  rows={series.map((s) => ({ name: s.name, color: s.color, value: Number(payload?.[0]?.payload?.[s.key] ?? 0) }))}
                />
              )}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                dot={rows.length === 1 ? { r: 4, fill: s.color, strokeWidth: 0 } : false}
                activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}

// ─── Category donut ───────────────────────────────────────────────────────────

function CategoryDonut({
  categories,
  total,
  colorOf,
}: {
  categories: NamedTotal[]
  total: number
  colorOf: (label: string) => string
}) {
  return (
    <Panel title="Category share" meta={`${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`}>
      <div className="relative h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={categories}
              dataKey="total"
              nameKey="label"
              innerRadius="62%"
              outerRadius="92%"
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {categories.map((c) => (
                <Cell key={c.key} fill={colorOf(c.label)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }: Tip) => {
                const row = payload?.[0]?.payload as NamedTotal | undefined
                return row ? (
                  <ChartTooltip active={active} label={`${row.label} · ${pct(row.share)}`} rows={[{ name: 'Spend', value: row.total, color: colorOf(row.label) }]} />
                ) : null
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-wider text-text-dim">Total</span>
          <span className="font-display text-sm font-bold tabular-nums">{nairaShort(total)}</span>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5 text-xs">
        {categories.slice(0, 8).map((c) => (
          <li key={c.key} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <Swatch color={colorOf(c.label)} />
              <span className="truncate">{c.label}</span>
            </span>
            <span className="tabular-nums text-text-dim">{pct(c.share)}</span>
          </li>
        ))}
        {categories.length > 8 ? <li className="text-text-muted">+{categories.length - 8} more in the table below</li> : null}
      </ul>
    </Panel>
  )
}

// ─── Horizontal bar (category / vendor / BU) ─────────────────────────────────

function HorizontalBars<T extends NamedTotal>({
  title,
  meta,
  rows,
  colorOf,
  className,
}: {
  title: string
  meta?: string
  rows: T[]
  colorOf: (row: T) => string
  className?: string
}) {
  return (
    <Panel title={title} meta={meta} className={className}>
      {rows.length === 0 ? (
        <EmptyState title="No data" />
      ) : (
        <div style={{ height: barHeight(rows.length) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} stroke={gridStroke} />
              <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={nairaShort} />
              <YAxis
                type="category"
                dataKey="label"
                tick={axisTick}
                axisLine={false}
                tickLine={false}
                width={120}
                tickFormatter={(v: string) => truncate(v)}
              />
              <Tooltip
                cursor={{ fill: 'var(--surface2)' }}
                content={({ active, payload }: Tip) => {
                  const row = payload?.[0]?.payload as T | undefined
                  return row ? (
                    <ChartTooltip
                      active={active}
                      label={`${row.label} · ${pct(row.share)}`}
                      rows={[
                        { name: 'Total', value: row.total, color: colorOf(row) },
                        { name: `Paid (${row.items} item${row.items === 1 ? '' : 's'})`, value: row.paid, color: 'transparent' },
                      ]}
                    />
                  ) : null
                }}
              />
              <Bar dataKey="total" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
                {rows.map((r) => (
                  <Cell key={r.key} fill={colorOf(r)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  )
}

// ─── Business units ──────────────────────────────────────────────────────────

function BusinessUnits({ data }: { data: MoneyOutReport }) {
  const rows = data.businessUnits
  const totals = rows.reduce((a, r) => ({ items: a.items + r.items, paid: a.paid + r.paid, total: a.total + r.total }), { items: 0, paid: 0, total: 0 })
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <HorizontalBars
        title="Spend by business unit"
        meta={`${rows.length} unit${rows.length === 1 ? '' : 's'}`}
        rows={rows}
        colorOf={(r) => (r.costCenterId ? SERIES_PRIMARY : 'var(--text-muted)')}
      />
      <Panel title="Business units" meta="Unassigned = lines with no BU">
        <TableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className={th}>BU</th>
                <th className={th}>Code</th>
                <th className={thNum}>Items</th>
                <th className={thNum}>Paid</th>
                <th className={thNum}>Total</th>
                <th className={thNum}>Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border/60">
                  <td className={td}>{r.costCenterId ? r.label : <span className="italic text-text-dim">{r.label}</span>}</td>
                  <td className={td + ' text-text-dim'}>{r.code ?? '—'}</td>
                  <td className={tdNum}>{r.items}</td>
                  <td className={tdNum}>{naira(r.paid)}</td>
                  <td className={tdNum + ' font-semibold'}>{naira(r.total)}</td>
                  <td className={tdNum + ' text-text-dim'}>{pct(r.share)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className={td}>Total</td>
                <td className={td} />
                <td className={tdNum}>{totals.items}</td>
                <td className={tdNum}>{naira(totals.paid)}</td>
                <td className={tdNum}>{naira(totals.total)}</td>
                <td className={tdNum}>100%</td>
              </tr>
            </tfoot>
          </table>
        </TableScroll>
      </Panel>
    </div>
  )
}

// ─── COA × Category ──────────────────────────────────────────────────────────

function CategoryMatrix<R extends { total: number; byCategory: Record<string, number> }>({
  firstCol,
  rows,
  rowLabel,
  categories,
  colorOf,
  totals,
}: {
  firstCol: string
  rows: R[]
  rowLabel: (r: R) => string
  categories: string[]
  colorOf: (label: string) => string
  totals: Record<string, number>
}) {
  const grand = Object.values(totals).reduce((a, b) => a + b, 0)
  return (
    <TableScroll>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={th}>{firstCol}</th>
            {categories.map((c) => (
              <th key={c} className={thNum}>
                <span className="inline-flex items-center gap-1.5">
                  <Swatch color={colorOf(c)} />
                  {c}
                </span>
              </th>
            ))}
            <th className={thNum}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowLabel(r)} className="border-b border-border/60">
              <td className={td}>{rowLabel(r)}</td>
              {categories.map((c) => (
                <td key={c} className={tdNum + (r.byCategory[c] ? '' : ' text-text-muted')}>
                  {r.byCategory[c] ? naira(r.byCategory[c]) : '—'}
                </td>
              ))}
              <td className={tdNum + ' font-semibold'}>{naira(r.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className={td}>Total</td>
            {categories.map((c) => (
              <td key={c} className={tdNum}>
                {naira(totals[c] ?? 0)}
              </td>
            ))}
            <td className={tdNum}>{naira(grand)}</td>
          </tr>
        </tfoot>
      </table>
    </TableScroll>
  )
}

function StackTooltip({ active, payload, label, categories, colorOf }: Tip & { categories: string[]; colorOf: (l: string) => string }) {
  const row = payload?.[0]?.payload as { total: number; byCategory: Record<string, number> } | undefined
  if (!row) return null
  const rows = categories
    .filter((c) => row.byCategory[c])
    .map((c) => ({ name: c, value: row.byCategory[c], color: colorOf(c) }))
  return <ChartTooltip active={active} label={label} rows={rows} total={row.total} />
}

function CoaSection({ data, colorOf }: { data: MoneyOutReport; colorOf: (l: string) => string }) {
  const { categories, rows } = data.coa
  const chartRows = rows.slice(0, COA_CHART_LIMIT)
  const totals = data.monthlyByCategory.totals
  return (
    <Panel
      title="Spend by COA"
      meta={rows.length > COA_CHART_LIMIT ? `Top ${COA_CHART_LIMIT} of ${rows.length} COA tags charted · all in the table` : `${rows.length} COA tag${rows.length === 1 ? '' : 's'}`}
      actions={<Legend items={categories.map((c) => ({ name: c, color: colorOf(c) }))} />}
    >
      <div style={{ height: barHeight(chartRows.length) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap={6}>
            <CartesianGrid horizontal={false} stroke={gridStroke} />
            <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={nairaShort} />
            <YAxis type="category" dataKey="coa" tick={axisTick} axisLine={false} tickLine={false} width={140} tickFormatter={(v: string) => truncate(v, 22)} />
            <Tooltip cursor={{ fill: 'var(--surface2)' }} content={(p: Tip) => <StackTooltip {...p} categories={categories} colorOf={colorOf} />} />
            {categories.map((c) => (
              <Bar
                key={c}
                name={c}
                stackId="coa"
                dataKey={(r: { byCategory: Record<string, number> }) => r.byCategory[c] ?? 0}
                fill={colorOf(c)}
                stroke="var(--surface)"
                strokeWidth={2}
                maxBarSize={22}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4">
        <CategoryMatrix firstCol="COA" rows={rows} rowLabel={(r) => r.coa} categories={categories} colorOf={colorOf} totals={totals} />
      </div>
    </Panel>
  )
}

// ─── Monthly by category ─────────────────────────────────────────────────────

function MonthlyByCategory({ data, colorOf }: { data: MoneyOutReport; colorOf: (l: string) => string }) {
  const { categories, rows, totals } = data.monthlyByCategory
  const chartRows = rows.map((r) => ({ ...r, label: monthLabel(r.month) }))
  return (
    <Panel title="Monthly spend by category" actions={<Legend items={categories.map((c) => ({ name: c, color: colorOf(c) }))} />}>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={gridStroke} />
            <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={nairaShort} width={60} />
            <Tooltip cursor={{ fill: 'var(--surface2)' }} content={(p: Tip) => <StackTooltip {...p} categories={categories} colorOf={colorOf} />} />
            {categories.map((c) => (
              <Bar
                key={c}
                name={c}
                stackId="month"
                dataKey={(r: { byCategory: Record<string, number> }) => r.byCategory[c] ?? 0}
                fill={colorOf(c)}
                stroke="var(--surface)"
                strokeWidth={2}
                maxBarSize={48}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4">
        <CategoryMatrix firstCol="Month" rows={rows} rowLabel={(r) => monthLabel(r.month)} categories={categories} colorOf={colorOf} totals={totals} />
      </div>
    </Panel>
  )
}

// ─── Batch history ───────────────────────────────────────────────────────────

function BatchHistory({ rows }: { rows: MoneyOutReport['batchHistory'] }) {
  return (
    <Panel title="Batch / disbursement history" meta={`${rows.length} batch${rows.length === 1 ? '' : 'es'}`}>
      {rows.length === 0 ? (
        <EmptyState title="No batches in this period" />
      ) : (
        <TableScroll className="max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border">
                <th className={th}>Batch ref</th>
                <th className={th}>Date</th>
                <th className={th}>Category</th>
                <th className={thNum}>Items</th>
                <th className={thNum}>Total</th>
                <th className={thNum}>Paid</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.batchId} className="border-b border-border/60">
                  <td className={td + ' font-mono text-xs'}>{b.batchRef}</td>
                  <td className={td}>{shortDate(b.date)}</td>
                  <td className={td}>{b.category}</td>
                  <td className={tdNum}>{b.items}</td>
                  <td className={tdNum + ' font-semibold'}>{naira(b.total)}</td>
                  <td className={tdNum}>{naira(b.paid)}</td>
                  <td className={td}>
                    <StatusPill status={b.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  )
}
