import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { VendorPicker, vendorHasBank } from '@/components/shared/VendorPicker'
import { CategoryCoaPicker } from '@/components/shared/CategoryCoaPicker'
import { BuHeadPicker } from '@/components/shared/BuHeadPicker'
import { UnitNameSelect } from '@/components/shared/UnitNameSelect'
import { formatNaira } from '@/lib/money'
import { apiErrorCode, apiErrorMessage, apiErrors, queueApi, queueKeys } from '@/lib/api/queue'
import type { BundleSubItemPayload, DuplicateMatch, QueueBundleEntry } from '@/types/queue'
import type { Vendor } from '@/types/vendors'
import { Field, ModalFooter, todayISO } from './common'
import { StockSelect, WhtBox } from './helpers'
import { DuplicateConfirm } from './AddQueueItemModal'

interface Row {
  key: number
  vendor: Vendor | null
  description: string
  units: string
  unitName: string
  unitAmount: string
}

let seq = 1
const newRow = (): Row => ({ key: seq++, vendor: null, description: '', units: '1', unitName: '', unitAmount: '' })
const rowTotal = (r: Row) => Math.round((Number(r.units) || 0) * (Number(r.unitAmount) || 0) * 100) / 100

/** "New bundle" (many items, one queue entry), or "+ Add items to bundle" when `bundle` is set. */
export function BundleModal({
  open,
  bundle,
  onClose,
  buRequired,
  canApprove,
}: {
  open: boolean
  bundle?: QueueBundleEntry | null
  onClose: () => void
  buRequired: boolean
  canApprove: boolean
}) {
  const qc = useQueryClient()
  const addMode = !!bundle
  const [date, setDate] = useState(todayISO())
  const [label, setLabel] = useState('')
  const [cat, setCat] = useState<{ payCategoryId: string | null; coaTagId: string | null; coaTagName: string | null }>({
    payCategoryId: null,
    coaTagId: null,
    coaTagName: null,
  })
  const [bu, setBu] = useState<{ costCenterId: string | null; locationId: string | null }>({ costCenterId: null, locationId: null })
  const [pnl, setPnl] = useState('')
  const [wht, setWht] = useState<number | null>(null)
  const [rows, setRows] = useState<Row[]>([newRow(), newRow()])
  const [dups, setDups] = useState<DuplicateMatch[] | null>(null)

  useEffect(() => {
    if (!open) return
    setDate(todayISO())
    setLabel('')
    setCat({ payCategoryId: null, coaTagId: null, coaTagName: null })
    setBu({ costCenterId: null, locationId: null })
    setPnl('')
    setWht(null)
    setRows(addMode ? [newRow()] : [newRow(), newRow()])
  }, [open, addMode])

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const filled = rows.filter((r) => r.vendor || r.description.trim() || Number(r.unitAmount) > 0)
  const total = filled.reduce((s, r) => s + rowTotal(r), 0)

  const rowsValid =
    filled.length > 0 && filled.every((r) => r.vendor && vendorHasBank(r.vendor) && r.description.trim() && Number(r.unitAmount) > 0 && Number(r.units) > 0)
  const headerValid = addMode || (label.trim() && cat.payCategoryId && cat.coaTagId && (!buRequired || (bu.costCenterId && bu.locationId)))

  const items = (): BundleSubItemPayload[] =>
    filled.map((r) => ({
      vendorId: r.vendor!.id,
      description: r.description.trim(),
      units: Number(r.units) || 1,
      unitName: r.unitName || undefined,
      unitAmount: Number(r.unitAmount),
    }))

  const save = useMutation({
    mutationFn: (confirmDuplicate: boolean) =>
      addMode
        ? queueApi.addBundleItems(bundle!.bundleId, items(), confirmDuplicate)
        : queueApi.createBundle({
            date,
            bundleLabel: label.trim(),
            payCategoryId: cat.payCategoryId!,
            coaTagId: cat.coaTagId!,
            costCenterId: bu.costCenterId || undefined,
            locationId: bu.locationId || undefined,
            pnlPeriod: pnl || undefined,
            ...(wht !== null && { whtRateOverride: wht }),
            items: items(),
            confirmDuplicate,
          }),
    onSuccess: () => {
      toast.success(addMode ? 'Items added to bundle' : 'Bundle added to queue')
      qc.invalidateQueries({ queryKey: queueKeys.all })
      setDups(null)
      onClose()
    },
    onError: (e) => {
      if (apiErrorCode(e) === 'DUPLICATE_WARNING') {
        setDups(apiErrors<{ duplicates: DuplicateMatch[] }>(e)?.duplicates ?? [])
        return
      }
      const rowErrs = apiErrors<{ rows?: { row: number; error: string }[] }>(e)?.rows
      toast.error(rowErrs?.length ? rowErrs.map((r) => `Row ${r.row}: ${r.error}`).join(' · ') : apiErrorMessage(e))
    },
  })

  return (
    <>
      <Modal
        isOpen={open}
        onClose={onClose}
        title={addMode ? `Add items to “${bundle?.bundleLabel ?? 'bundle'}”` : 'New bundle'}
        description={addMode ? "New sub-items inherit the bundle's date, category, COA, BU and P&L period." : 'Many items, one queue entry. Each sub-item pays its own vendor.'}
        className="max-w-4xl"
      >
        <div className="space-y-4">
          {!addMode && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Date">
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Bundle label" required className="sm:col-span-2">
                  <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Kitchen restock – week 44" />
                </Field>
              </div>
              <CategoryCoaPicker
                required
                payCategoryId={cat.payCategoryId}
                coaTagId={cat.coaTagId}
                onChange={(v) => setCat({ payCategoryId: v.payCategoryId, coaTagId: v.coaTagId, coaTagName: v.coaTagName ?? null })}
              />
              <BuHeadPicker required={buRequired} costCenterId={bu.costCenterId} locationId={bu.locationId} onChange={setBu} />
              <Field label="Activity month" hint="P&L period for every line">
                <Input type="month" value={pnl} onChange={(e) => setPnl(e.target.value)} className="sm:max-w-xs" />
              </Field>
            </>
          )}

          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-dim">Sub-items</div>
            <div className="space-y-2">
              {rows.map((r, idx) => (
                <div key={r.key} className="grid grid-cols-2 gap-2 rounded-xl border border-border p-2 md:grid-cols-12 md:items-center">
                  <div className="col-span-2 md:col-span-3">
                    <VendorPicker value={r.vendor?.id} blockNoBank onChange={(v) => setRow(r.key, { vendor: v })} placeholder="Vendor…" />
                  </div>
                  <Input
                    className="col-span-2 md:col-span-3"
                    placeholder="Description"
                    value={r.description}
                    onChange={(e) => setRow(r.key, { description: e.target.value })}
                  />
                  <div className="col-span-2 md:col-span-2">
                    <StockSelect
                      onPick={(s) =>
                        setRow(r.key, { description: s.description || s.name, unitName: s.unitName ?? '', unitAmount: String(Number(s.unitAmount) || '') })
                      }
                    />
                  </div>
                  <Input className="md:col-span-1" type="number" step="any" placeholder="Qty" value={r.units} onChange={(e) => setRow(r.key, { units: e.target.value })} />
                  <div className="md:col-span-1">
                    <UnitNameSelect value={r.unitName} onChange={(u) => setRow(r.key, { unitName: u })} />
                  </div>
                  <Input
                    className="md:col-span-1"
                    type="number"
                    step="any"
                    placeholder="Price"
                    value={r.unitAmount}
                    onChange={(e) => setRow(r.key, { unitAmount: e.target.value })}
                  />
                  <div className="flex items-center justify-end gap-1 md:col-span-1">
                    <span className="text-sm font-semibold tabular-nums">{formatNaira(rowTotal(r))}</span>
                    {rows.length > 1 && (
                      <button className="p-1 text-text-dim hover:text-red" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove row ${idx + 1}`}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <button className="inline-flex items-center gap-1 text-xs font-semibold text-gold" onClick={() => setRows((rs) => [...rs, newRow()])}>
                <Plus size={12} /> Add row
              </button>
              <span className="text-sm">
                Total <span className="ml-1 text-lg font-bold tabular-nums">{formatNaira(total)}</span>
              </span>
            </div>
          </div>

          {!addMode && (
            <WhtBox coaName={cat.coaTagName} total={total} override={wht} onOverride={setWht} canOverride={canApprove} />
          )}
        </div>
        <ModalFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!rowsValid || !headerValid} isLoading={save.isPending && !dups} onClick={() => save.mutate(false)}>
            {addMode ? `Add ${filled.length} item${filled.length === 1 ? '' : 's'}` : `Add Bundle (${filled.length})`}
          </Button>
        </ModalFooter>
      </Modal>
      <DuplicateConfirm duplicates={dups} busy={save.isPending} onCancel={() => setDups(null)} onConfirm={() => save.mutate(true)} />
    </>
  )
}
