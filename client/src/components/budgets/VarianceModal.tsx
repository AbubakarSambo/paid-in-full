import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Printer } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatNaira } from '@/lib/money'
import { budgetKeys, budgetsApi } from '@/lib/api/budgets'
import { apiErrorMessage } from '@/lib/api/queue'
import type { VariancePreset } from '@/types/budgets'
import { shortDate, todayISO } from '@/components/queue/common'

const PRESETS: { key: VariancePreset; label: string }[] = [
  { key: 'mtd', label: 'Month to date' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_30', label: 'Last 30 days' },
  { key: 'last_90', label: 'Last 90 days' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'custom', label: 'Custom' },
]

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .pif-variance-print, .pif-variance-print * { visibility: visible !important; }
  .pif-variance-print { position: absolute !important; left: 0; top: 0; width: 100% !important; max-width: none !important;
    max-height: none !important; overflow: visible !important; border: none !important; box-shadow: none !important;
    background: #fff !important; color: #111 !important; }
  .pif-variance-print * { color: #111 !important; background: transparent !important; border-color: #ccc !important; }
  .pif-no-print { display: none !important; }
}`

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-[11px] font-semibold',
        active ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-dim hover:border-gold/40',
      )}
    >
      {children}
    </button>
  )
}

export function VarianceModal({
  open,
  onClose,
  businessUnits,
  initialBu,
}: {
  open: boolean
  onClose: () => void
  businessUnits: { id: string; name: string; code: string | null }[]
  initialBu: string
}) {
  const [preset, setPreset] = useState<VariancePreset>('this_month')
  const [from, setFrom] = useState(todayISO().slice(0, 8) + '01')
  const [to, setTo] = useState(todayISO())
  const [bu, setBu] = useState(initialBu)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const customReady = preset !== 'custom' || (from && to && from <= to)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: budgetKeys.variance(preset, from, to, bu),
    queryFn: () => budgetsApi.variance({ preset, from, to, bu }),
    enabled: open && !!customReady,
  })
  const buName = bu === 'all' ? 'All business units' : bu === 'none' ? 'Workspace-wide' : businessUnits.find((b) => b.id === bu)?.name ?? ''

  return (
    <Modal isOpen={open} onClose={onClose} title="Variance report" description="Positive variance is under budget." className="pif-variance-print max-w-4xl">
      <style>{PRINT_CSS}</style>
      <div className="pif-no-print space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Chip key={p.key} active={preset === p.key} onClick={() => setPreset(p.key)}>
              {p.label}
            </Chip>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 rounded-md border border-input bg-card px-2" />
            to
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 rounded-md border border-input bg-card px-2" />
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Chip active={bu === 'all'} onClick={() => setBu('all')}>
            All BUs
          </Chip>
          {businessUnits.map((b) => (
            <Chip key={b.id} active={bu === b.id} onClick={() => setBu(b.id)}>
              {b.code || b.name}
            </Chip>
          ))}
          <Chip active={bu === 'none'} onClick={() => setBu('none')}>
            No BU
          </Chip>
        </div>
      </div>

      {data && (
        <div className="mt-3 text-xs text-text-dim">
          {shortDate(data.summary.from)} – {shortDate(data.summary.to)} {data.summary.to.slice(0, 4)} · {data.summary.days} days · {buName}. Monthly budgets
          are pro-rated by days in range.
        </div>
      )}

      {isLoading ? (
        <div className="py-10 text-center text-sm text-text-dim">Loading…</div>
      ) : isError ? (
        <div className="py-10 text-center text-sm text-red">{apiErrorMessage(error)}</div>
      ) : data ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Budget', v: formatNaira(data.summary.budget) },
              { label: 'Actual', v: formatNaira(data.summary.actual) },
              { label: 'Variance', v: formatNaira(data.summary.variance), tone: data.summary.variance >= 0 ? 'text-green' : 'text-red' },
              {
                label: 'Variance %',
                v: data.summary.variancePct === null ? '—' : `${data.summary.variancePct}%`,
                tone: (data.summary.variancePct ?? 0) >= 0 ? 'text-green' : 'text-red',
              },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-border p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{k.label}</div>
                <div className={cn('text-lg font-bold tabular-nums', k.tone)}>{k.v}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-surface2 text-[10px] uppercase tracking-wider text-text-dim">
                <tr className="[&>th]:px-3 [&>th]:py-2">
                  <th className="text-left">COA tag</th>
                  <th className="text-right">Budget</th>
                  <th className="text-right">Actual</th>
                  <th className="text-right">Variance</th>
                  <th className="text-right">Var %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-text-dim">
                      No budget or spend in this range.
                    </td>
                  </tr>
                )}
                {data.rows.map((r) => {
                  const open = expanded.has(r.coaTagId)
                  return (
                    <Fragment key={r.coaTagId}>
                      <tr
                        className="cursor-pointer hover:bg-surface2/50 [&>td]:px-3 [&>td]:py-2"
                        onClick={() =>
                          setExpanded((s) => {
                            const n = new Set(s)
                            if (n.has(r.coaTagId)) n.delete(r.coaTagId)
                            else n.add(r.coaTagId)
                            return n
                          })
                        }
                      >
                        <td>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="pif-no-print">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
                            <span className="h-2 w-2 rounded-full" style={{ background: r.payCategory.color }} />
                            {r.coaTag}
                            <span className="text-[11px] text-text-muted">({r.lines.length})</span>
                          </span>
                        </td>
                        <td className="text-right">{formatNaira(r.budget)}</td>
                        <td className="text-right">{formatNaira(r.actual)}</td>
                        <td className={cn('text-right font-semibold', r.variance >= 0 ? 'text-green' : 'text-red')}>{formatNaira(r.variance)}</td>
                        <td className={cn('text-right', (r.variancePct ?? 0) >= 0 ? 'text-green' : 'text-red')}>
                          {r.variancePct === null ? '—' : `${r.variancePct}%`}
                        </td>
                      </tr>
                      {open &&
                        r.lines.map((l) => (
                          <tr key={`${l.source}-${l.id}`} className="bg-background/40 text-xs text-text-dim [&>td]:px-3 [&>td]:py-1.5">
                            <td className="pl-9" colSpan={2}>
                              {shortDate(l.date)} · {l.vendorName} · {l.description}
                            </td>
                            <td className="text-right">{formatNaira(l.total)}</td>
                            <td colSpan={2} className="text-right">
                              {l.source === 'batch' ? l.batchRef : 'In queue'} · {l.status.toLowerCase()}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div className="pif-no-print mt-6 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button size="sm" disabled={!data} onClick={() => window.print()}>
          <Printer size={14} /> Print
        </Button>
      </div>
    </Modal>
  )
}
