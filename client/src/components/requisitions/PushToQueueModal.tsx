import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Info } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatNaira } from '@/lib/money'
import { requisitionKeys, requisitionsApi } from '@/lib/api/requisitions'
import { apiErrorMessage, apiErrors, queueKeys } from '@/lib/api/queue'
import type { RequisitionRow } from '@/types/requisitions'
import { ModalFooter, monthISO, useQueueLookups } from '@/components/queue/common'

interface Line {
  payCategoryId: string
  coaTagId: string
  costCenterId: string
  locationId: string
  pnlPeriod: string
}

const sel = 'h-9 w-full rounded-md border border-input bg-card px-2 text-xs focus:border-gold focus:outline-none disabled:opacity-50'

/** "Accounts assigns the payment category, chart of accounts" — per line, with Apply to all. */
export function PushToQueueModal({ rows, onClose, onDone }: { rows: RequisitionRow[] | null; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient()
  const { activeCategories, costCenters } = useQueueLookups()
  const [lines, setLines] = useState<Record<string, Line>>({})
  const [all, setAll] = useState<Line>({ payCategoryId: '', coaTagId: '', costCenterId: '', locationId: '', pnlPeriod: monthISO() })
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!rows) return
    setErrors({})
    setLines(
      Object.fromEntries(
        rows.map((r) => [
          r.id,
          {
            payCategoryId: r.payCategoryId ?? '',
            coaTagId: r.coaTagId ?? '',
            costCenterId: r.costCenterId ?? '',
            locationId: r.locationId ?? '',
            pnlPeriod: String(r.date).slice(0, 7) || monthISO(),
          },
        ]),
      ),
    )
  }, [rows])

  const setLine = (id: string, patch: Partial<Line>) => setLines((ls) => ({ ...ls, [id]: { ...ls[id], ...patch } }))
  const applyAll = () =>
    setLines((ls) =>
      Object.fromEntries(
        Object.entries(ls).map(([id, l]) => [
          id,
          {
            payCategoryId: all.payCategoryId || l.payCategoryId,
            coaTagId: all.payCategoryId ? all.coaTagId : l.coaTagId,
            costCenterId: all.costCenterId || l.costCenterId,
            locationId: all.costCenterId ? all.locationId : l.locationId,
            pnlPeriod: all.pnlPeriod || l.pnlPeriod,
          },
        ]),
      ),
    )

  const push = useMutation({
    mutationFn: () =>
      requisitionsApi.pushToQueue(
        (rows ?? []).map((r) => {
          const l = lines[r.id]
          return {
            requisitionId: r.id,
            payCategoryId: l.payCategoryId || undefined,
            coaTagId: l.coaTagId || undefined,
            costCenterId: l.costCenterId || undefined,
            locationId: l.locationId || undefined,
            pnlPeriod: l.pnlPeriod || undefined,
          }
        }),
      ),
    onSuccess: (res) => {
      toast.success(`${res.pushed.length} requisition${res.pushed.length === 1 ? '' : 's'} pushed to the queue`)
      qc.invalidateQueries({ queryKey: requisitionKeys.all })
      qc.invalidateQueries({ queryKey: queueKeys.all })
      onDone()
    },
    onError: (e) => {
      const errs = apiErrors<{ lines?: { requisitionId: string; error: string }[] }>(e)?.lines
      if (errs?.length) setErrors(Object.fromEntries(errs.map((x) => [x.requisitionId, x.error])))
      toast.error(apiErrorMessage(e))
    },
  })

  const ready = (rows ?? []).every((r) => lines[r.id]?.payCategoryId && lines[r.id]?.coaTagId)
  const total = (rows ?? []).reduce((s, r) => s + Number(r.total), 0)

  const renderSelects = (v: Line, onChange: (p: Partial<Line>) => void) => {
    const cat = activeCategories.find((c) => c.id === v.payCategoryId)
    const bu = costCenters.find((b) => b.id === v.costCenterId)
    return (
      <>
        <select className={sel} value={v.payCategoryId} onChange={(e) => onChange({ payCategoryId: e.target.value, coaTagId: '' })}>
          <option value="">Category…</option>
          {activeCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className={sel} value={v.coaTagId} disabled={!cat} onChange={(e) => onChange({ coaTagId: e.target.value })}>
          <option value="">COA…</option>
          {(cat?.coaTags ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className={sel} value={v.costCenterId} onChange={(e) => onChange({ costCenterId: e.target.value, locationId: '' })}>
          <option value="">BU…</option>
          {costCenters.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select className={sel} value={v.locationId} disabled={!bu} onChange={(e) => onChange({ locationId: e.target.value })}>
          <option value="">BU Head…</option>
          {(bu?.locations ?? [])
            .filter((l) => l.isActive)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.isGeneral ? '✦ General (split)' : l.name}
              </option>
            ))}
        </select>
        <input type="month" className={sel} value={v.pnlPeriod} onChange={(e) => onChange({ pnlPeriod: e.target.value })} />
      </>
    )
  }

  return (
    <Modal
      isOpen={!!rows}
      onClose={onClose}
      title="Push to queue"
      description="Accounts assigns the payment category, chart of accounts, BU and P&L period. Every line needs a category and COA."
      className="max-w-5xl"
    >
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-gold/30 bg-gold/5 p-2 md:grid-cols-6 md:items-center">
        <div className="col-span-2 text-[11px] font-semibold uppercase tracking-wider text-gold md:col-span-1">Apply to all</div>
        {renderSelects(all, (p) => setAll((a) => ({ ...a, ...p })))}
        <div className="col-span-2 flex justify-end md:col-span-6">
          <Button size="sm" variant="outline" onClick={applyAll}>
            Apply to all lines
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {(rows ?? []).map((r) => (
          <div key={r.id} className={cn('rounded-xl border p-2', errors[r.id] ? 'border-red/50 bg-red/5' : 'border-border')}>
            <div className="mb-2 flex items-start justify-between gap-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.description}</div>
                <div className="text-[11px] text-text-dim">
                  {r.vendor?.name ?? r.vendorName} {r.isNewVendor ? '· new vendor (registered on push)' : ''} · {r.reqRef}
                </div>
              </div>
              <span className="font-semibold tabular-nums">{formatNaira(r.total)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              {lines[r.id] && renderSelects(lines[r.id], (p) => setLine(r.id, p))}
            </div>
            {errors[r.id] && <div className="mt-1 text-[11px] text-red">{errors[r.id]}</div>}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-start gap-2 text-[11px] text-text-muted">
        <Info size={12} className="mt-0.5 shrink-0" />
        WHT is resolved automatically from the vendor and COA. An approver can override it from the queue item's details.
      </div>
      <ModalFooter>
        <span className="mr-auto text-sm">
          Total <span className="font-bold tabular-nums">{formatNaira(total)}</span>
        </span>
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={!ready} isLoading={push.isPending} onClick={() => push.mutate()}>
          Push {rows?.length ?? 0} to queue
        </Button>
      </ModalFooter>
    </Modal>
  )
}
