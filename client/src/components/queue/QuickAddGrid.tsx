import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Plus, Save, Sparkles, Upload, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatNaira } from '@/lib/money'
import { useActiveStock, useAllVendors } from '@/components/shared/hooks'
import { vendorHasBank } from '@/components/shared/VendorPicker'
import { UNIT_NAMES } from '@/components/shared/UnitNameSelect'
import { aiApi } from '@/lib/api/ai'
import { apiErrorCode, apiErrorMessage, apiErrors, queueApi, queueKeys } from '@/lib/api/queue'
import type { QueueLinePayload } from '@/types/queue'
import { todayISO, useQueueLookups } from './common'
import { saveBlob } from './helpers'

interface GridRow {
  key: string
  date: string
  vendorId: string
  description: string
  costCenterId: string
  locationId: string
  payCategoryId: string
  coaTagId: string
  units: string
  unitName: string
  unitAmount: string
  pnlPeriod: string
  isUrgent: boolean
}

const DRAFT_KEY = 'pif.queue.quickAddDraft'
const newRow = (): GridRow => ({
  key: Math.random().toString(36).slice(2),
  date: todayISO(),
  vendorId: '',
  description: '',
  costCenterId: '',
  locationId: '',
  payCategoryId: '',
  coaTagId: '',
  units: '1',
  unitName: '',
  unitAmount: '',
  pnlPeriod: '',
  isUrgent: false,
})
const isBlank = (r: GridRow) => !r.vendorId && !r.description.trim() && !r.unitAmount
const rowTotal = (r: GridRow) => Math.round((Number(r.units) || 0) * (Number(r.unitAmount) || 0) * 100) / 100

const cell =
  'h-9 w-full rounded-md border border-transparent bg-surface2/60 px-2 text-xs text-foreground focus:border-gold focus:outline-none disabled:opacity-50'

function loadDraft(): GridRow[] | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const rows = JSON.parse(raw) as GridRow[]
    return Array.isArray(rows) && rows.some((r) => !isBlank(r)) ? rows : null
  } catch {
    return null
  }
}

export function QuickAddGrid({ onClose, onUploadCsv }: { onClose: () => void; onUploadCsv: () => void }) {
  const qc = useQueryClient()
  const { activeCategories, costCenters, buRequired } = useQueueLookups()
  const { data: vendors = [] } = useAllVendors()
  const { data: stock = [] } = useActiveStock()
  const [restored] = useState(() => loadDraft())
  const [rows, setRows] = useState<GridRow[]>(() => restored ?? [newRow(), newRow(), newRow()])
  const [showRestored, setShowRestored] = useState(!!restored)
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({})
  const [aiBusy, setAiBusy] = useState<string | null>(null)

  useEffect(() => {
    try {
      if (rows.some((r) => !isBlank(r))) localStorage.setItem(DRAFT_KEY, JSON.stringify(rows))
      else localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* ignore */
    }
  }, [rows])

  const vendorsSorted = useMemo(() => [...vendors].filter((v) => v.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)), [vendors])
  const set = (key: string, patch: Partial<GridRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const filled = rows.filter((r) => !isBlank(r))
  const grand = filled.reduce((s, r) => s + rowTotal(r), 0)

  const discard = () => {
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* ignore */
    }
    setRows([newRow(), newRow(), newRow()])
    setShowRestored(false)
    setRowErrors({})
  }

  const improve = async (r: GridRow) => {
    if (!r.description.trim()) return toast.error('Type a description first')
    setAiBusy(r.key)
    try {
      const vendor = vendors.find((v) => v.id === r.vendorId)
      const res = await aiApi.improveDescriptions([{ description: r.description, vendorName: vendor?.name, date: r.date, amount: rowTotal(r) }])
      const out = res.items[0]
      if (!out) return
      const patch: Partial<GridRow> = { description: out.improved }
      if (out.suggestion && !r.payCategoryId) {
        patch.payCategoryId = out.suggestion.payCategoryId
        patch.coaTagId = out.suggestion.coaTagId
      }
      set(r.key, patch)
      if (!out.changed && !out.suggestion) toast.message('Already follows the guide')
    } catch (e) {
      toast.error(apiErrorMessage(e, 'AI improve failed'))
    } finally {
      setAiBusy(null)
    }
  }

  const toPayload = (r: GridRow): QueueLinePayload => ({
    date: r.date || undefined,
    vendorId: r.vendorId,
    description: r.description.trim(),
    payCategoryId: r.payCategoryId,
    coaTagId: r.coaTagId,
    costCenterId: r.costCenterId || undefined,
    locationId: r.locationId || undefined,
    units: Number(r.units) || 1,
    unitName: r.unitName || undefined,
    unitAmount: Number(r.unitAmount) || 0,
    pnlPeriod: r.pnlPeriod || undefined,
    isUrgent: r.isUrgent,
  })

  const save = useMutation({
    mutationFn: (confirm: boolean) => queueApi.bulk(filled.map(toPayload), confirm),
    onSuccess: (res) => {
      toast.success(`${res.created} expense${res.created === 1 ? '' : 's'} saved · ${formatNaira(res.total)}`)
      qc.invalidateQueries({ queryKey: queueKeys.all })
      discard()
      onClose()
    },
    onError: (e) => {
      if (apiErrorCode(e) === 'DUPLICATE_WARNING') {
        const dupRows = apiErrors<{ rows?: { row: number }[] }>(e)?.rows ?? []
        const ok = window.confirm(
          `Possible duplicate on row${dupRows.length === 1 ? '' : 's'} ${dupRows.map((d) => d.row).join(', ')}: same vendor and amount within 7 days. Save anyway?`,
        )
        if (ok) save.mutate(true)
        return
      }
      const errs = apiErrors<{ rows?: { row: number; error: string }[] }>(e)?.rows
      if (errs?.length) {
        setRowErrors(Object.fromEntries(errs.map((x) => [x.row - 1, x.error])))
        toast.error(`${errs.length} row(s) need fixing before saving`)
      } else toast.error(apiErrorMessage(e))
    },
  })

  const localProblems = filled.some(
    (r) => !r.vendorId || !r.description.trim() || !r.payCategoryId || !r.coaTagId || !(Number(r.unitAmount) > 0) || (buRequired && !r.costCenterId),
  )

  return (
    <section className="rounded-2xl border border-gold/30 bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-bold uppercase tracking-wider">New entries</div>
          <div className="text-[11px] text-text-muted">Quick add — every row needs vendor, description, category, COA and amount.</div>
        </div>
        <button className="rounded-md p-1.5 text-text-dim hover:bg-surface2" onClick={onClose} aria-label="Close quick add">
          <X size={16} />
        </button>
      </header>
      {showRestored && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-gold/5 px-4 py-2 text-xs">
          <span>Draft restored — your unsaved entries were kept.</span>
          <button className="font-semibold text-red hover:underline" onClick={discard}>
            Discard draft
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1500px] text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-text-dim">
            <tr className="[&>th]:px-1.5 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold">
              <th className="w-[120px]">Date</th>
              <th className="w-[170px]">Vendor*</th>
              <th className="w-[230px]">Description*</th>
              <th className="w-[120px]">Stock</th>
              <th className="w-8" title="Improve with AI — cleans up description, suggests category & COA">AI</th>
              <th className="w-[120px]">BU{buRequired ? '*' : ''}</th>
              <th className="w-[120px]">BU Head</th>
              <th className="w-[110px]">Category*</th>
              <th className="w-[140px]">COA*</th>
              <th className="w-[60px]">Units</th>
              <th className="w-[80px]">Unit</th>
              <th className="w-[100px]">Unit Amt*</th>
              <th className="w-[100px] text-right">Total</th>
              <th className="w-[120px]">Activity Month</th>
              <th className="w-8" />
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const cat = activeCategories.find((c) => c.id === r.payCategoryId)
              const bu = costCenters.find((b) => b.id === r.costCenterId)
              const vendor = vendors.find((v) => v.id === r.vendorId)
              const err = rowErrors[filled.indexOf(r)]
              return (
                <tr key={r.key} className={cn('[&>td]:px-1 [&>td]:py-1 align-top', err && 'bg-red/5')}>
                  <td>
                    <input type="date" className={cell} value={r.date} onChange={(e) => set(r.key, { date: e.target.value })} />
                  </td>
                  <td>
                    <select className={cn(cell, vendor && !vendorHasBank(vendor) && 'text-orange')} value={r.vendorId} onChange={(e) => set(r.key, { vendorId: e.target.value })}>
                      <option value="">Vendor…</option>
                      {vendorsSorted.map((v) => (
                        <option key={v.id} value={v.id} disabled={!vendorHasBank(v)}>
                          {v.name}
                          {vendorHasBank(v) ? '' : ' — no bank details'}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className={cell}
                      value={r.description}
                      placeholder="Item – Detail – Qty – DD/MM/YYYY"
                      onChange={(e) => set(r.key, { description: e.target.value })}
                    />
                    {err && <div className="mt-0.5 text-[10px] text-red">{err}</div>}
                  </td>
                  <td>
                    <select
                      className={cell}
                      value=""
                      onChange={(e) => {
                        const s = stock.find((x) => x.id === e.target.value)
                        if (s)
                          set(r.key, {
                            description: s.description || s.name,
                            payCategoryId: s.payCategoryId ?? r.payCategoryId,
                            coaTagId: s.coaTagId ?? r.coaTagId,
                            vendorId: s.vendorId ?? r.vendorId,
                            unitName: s.unitName ?? r.unitName,
                            unitAmount: String(Number(s.unitAmount) || ''),
                          })
                      }}
                    >
                      <option value="">Stock…</option>
                      {stock.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      className="flex h-9 w-8 items-center justify-center rounded-md text-gold hover:bg-gold/10 disabled:opacity-40"
                      title="Improve with AI — cleans up description, suggests category & COA"
                      disabled={aiBusy === r.key}
                      onClick={() => improve(r)}
                    >
                      <Sparkles size={14} className={aiBusy === r.key ? 'animate-pulse' : ''} />
                    </button>
                  </td>
                  <td>
                    <select className={cell} value={r.costCenterId} onChange={(e) => set(r.key, { costCenterId: e.target.value, locationId: '' })}>
                      <option value="">BU…</option>
                      {costCenters.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code || b.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className={cell} value={r.locationId} disabled={!bu} onChange={(e) => set(r.key, { locationId: e.target.value })}>
                      <option value="">Head…</option>
                      {(bu?.locations ?? [])
                        .filter((l) => l.isActive)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.isGeneral ? '✦ General (split)' : l.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <select className={cell} value={r.payCategoryId} onChange={(e) => set(r.key, { payCategoryId: e.target.value, coaTagId: '' })}>
                      <option value="">Category…</option>
                      {activeCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className={cell} value={r.coaTagId} disabled={!cat} onChange={(e) => set(r.key, { coaTagId: e.target.value })}>
                      <option value="">COA…</option>
                      {(cat?.coaTags ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input type="number" step="any" className={cn(cell, 'text-right')} value={r.units} onChange={(e) => set(r.key, { units: e.target.value })} />
                  </td>
                  <td>
                    <select className={cell} value={r.unitName} onChange={(e) => set(r.key, { unitName: e.target.value })}>
                      <option value="">—</option>
                      {UNIT_NAMES.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      className={cn(cell, 'text-right')}
                      value={r.unitAmount}
                      onChange={(e) => set(r.key, { unitAmount: e.target.value })}
                    />
                  </td>
                  <td className="pt-3 text-right font-semibold tabular-nums">{formatNaira(rowTotal(r))}</td>
                  <td>
                    <input type="month" className={cell} value={r.pnlPeriod} onChange={(e) => set(r.key, { pnlPeriod: e.target.value })} />
                  </td>
                  <td>
                    <button
                      className={cn('flex h-9 w-8 items-center justify-center rounded-md hover:bg-surface2', r.isUrgent ? 'text-orange' : 'text-text-muted')}
                      title={r.isUrgent ? 'Urgent' : 'Mark urgent'}
                      onClick={() => set(r.key, { isUrgent: !r.isUrgent })}
                    >
                      <Zap size={14} fill={r.isUrgent ? 'currentColor' : 'none'} />
                    </button>
                  </td>
                  <td>
                    <button
                      className="flex h-9 w-8 items-center justify-center rounded-md text-text-muted hover:text-red"
                      onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [newRow()]))}
                      aria-label={`Remove row ${idx + 1}`}
                    >
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
            <tr className="border-t border-border">
              <td colSpan={12} className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-text-dim">
                Grand total
              </td>
              <td className="px-1 py-2 text-right text-sm font-bold tabular-nums">{formatNaira(grand)}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <Button size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, newRow()])}>
          <Plus size={14} /> Add Row
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              saveBlob(await queueApi.csvTemplate(), 'queue-template.csv')
            } catch (e) {
              toast.error(apiErrorMessage(e))
            }
          }}
        >
          <Download size={14} /> Template
        </Button>
        <Button size="sm" variant="outline" onClick={onUploadCsv}>
          <Upload size={14} /> Upload CSV
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-text-muted">
            {filled.length} row{filled.length === 1 ? '' : 's'}
          </span>
          <Button size="sm" disabled={!filled.length || localProblems} isLoading={save.isPending} onClick={() => save.mutate(false)}>
            <Save size={14} /> Save Expenses
          </Button>
        </div>
      </footer>
    </section>
  )
}
