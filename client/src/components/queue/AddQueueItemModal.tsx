import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { VendorPicker, vendorHasBank } from '@/components/shared/VendorPicker'
import { CategoryCoaPicker } from '@/components/shared/CategoryCoaPicker'
import { BuHeadPicker } from '@/components/shared/BuHeadPicker'
import { UnitNameSelect } from '@/components/shared/UnitNameSelect'
import { DescriptionRulesHint } from '@/components/shared/DescriptionRulesHint'
import { formatNaira } from '@/lib/money'
import { apiErrorCode, apiErrorMessage, apiErrors, queueApi, queueKeys } from '@/lib/api/queue'
import type { DuplicateMatch, QueueLinePayload } from '@/types/queue'
import type { Vendor } from '@/types/vendors'
import { Field, ModalFooter, shortDate, todayISO } from './common'
import { AiTidyInline, StockSelect, WhtBox } from './helpers'

interface FormState {
  date: string
  vendor: Vendor | null
  description: string
  payCategoryId: string | null
  coaTagId: string | null
  coaTagName: string | null
  costCenterId: string | null
  locationId: string | null
  units: string
  unitName: string
  unitAmount: string
  pnlPeriod: string
  isUrgent: boolean
  whtOverride: number | null
}

const empty = (): FormState => ({
  date: todayISO(),
  vendor: null,
  description: '',
  payCategoryId: null,
  coaTagId: null,
  coaTagName: null,
  costCenterId: null,
  locationId: null,
  units: '1',
  unitName: '',
  unitAmount: '',
  pnlPeriod: '',
  isUrgent: false,
  whtOverride: null,
})

/** Duplicate-guard confirm (409 DUPLICATE_WARNING). */
export function DuplicateConfirm({
  duplicates,
  onCancel,
  onConfirm,
  busy,
}: {
  duplicates: DuplicateMatch[] | null
  onCancel: () => void
  onConfirm: () => void
  busy?: boolean
}) {
  return (
    <Modal isOpen={!!duplicates} onClose={onCancel} title="Possible duplicate" description="The same vendor and amount appear in the queue or batches within the last 7 days.">
      <div className="space-y-2">
        {(duplicates ?? []).map((d) => (
          <div key={`${d.source}-${d.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate">{d.description}</div>
              <div className="text-[11px] text-text-muted">
                {d.source === 'batch' ? `Batch ${d.batchRef ?? ''}` : 'In the queue'} · {shortDate(d.date)}
              </div>
            </div>
            <span className="font-semibold tabular-nums">{formatNaira(d.total)}</span>
          </div>
        ))}
      </div>
      <ModalFooter>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" isLoading={busy} onClick={onConfirm}>
          Add anyway
        </Button>
      </ModalFooter>
    </Modal>
  )
}

export function AddQueueItemModal({
  open,
  onClose,
  buRequired,
  canApprove,
}: {
  open: boolean
  onClose: () => void
  buRequired: boolean
  canApprove: boolean
}) {
  const qc = useQueryClient()
  const [f, setF] = useState<FormState>(empty)
  const [dups, setDups] = useState<DuplicateMatch[] | null>(null)
  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }))

  useEffect(() => {
    if (open) setF(empty())
  }, [open])

  const units = Number(f.units) || 0
  const unitAmount = Number(f.unitAmount) || 0
  const total = Math.round(units * unitAmount * 100) / 100

  const payload = (): QueueLinePayload => ({
    date: f.date || undefined,
    vendorId: f.vendor!.id,
    description: f.description.trim(),
    payCategoryId: f.payCategoryId!,
    coaTagId: f.coaTagId!,
    costCenterId: f.costCenterId || undefined,
    locationId: f.locationId || undefined,
    units,
    unitName: f.unitName || undefined,
    unitAmount,
    pnlPeriod: f.pnlPeriod || undefined,
    isUrgent: f.isUrgent,
    ...(f.whtOverride !== null && { whtRateOverride: f.whtOverride }),
  })

  const create = useMutation({
    mutationFn: (confirmDuplicate: boolean) => queueApi.create({ ...payload(), confirmDuplicate }),
    onSuccess: () => {
      toast.success('Added to queue')
      qc.invalidateQueries({ queryKey: queueKeys.all })
      setDups(null)
      onClose()
    },
    onError: (e) => {
      if (apiErrorCode(e) === 'DUPLICATE_WARNING') {
        setDups(apiErrors<{ duplicates: DuplicateMatch[] }>(e)?.duplicates ?? [])
        return
      }
      toast.error(apiErrorMessage(e))
    },
  })

  const problems: string[] = []
  if (!f.vendor) problems.push('vendor')
  else if (!vendorHasBank(f.vendor)) problems.push('vendor bank details')
  if (!f.description.trim()) problems.push('description')
  if (!f.payCategoryId || !f.coaTagId) problems.push('category & COA')
  if (buRequired && (!f.costCenterId || !f.locationId)) problems.push('business unit & BU head')
  if (!(unitAmount > 0) || !(units > 0)) problems.push('amount')

  return (
    <>
      <Modal isOpen={open} onClose={onClose} title="Add Queue Item" className="max-w-2xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Pick from stock" hint="Pre-fills the fields below">
              <StockSelect
                onPick={(s) =>
                  set({
                    description: s.description || s.name,
                    payCategoryId: s.payCategoryId,
                    coaTagId: s.coaTagId,
                    coaTagName: s.coaTag?.name ?? null,
                    unitName: s.unitName ?? '',
                    unitAmount: String(Number(s.unitAmount) || ''),
                  })
                }
              />
            </Field>
            <Field label="Date">
              <Input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
            </Field>
          </div>
          <Field label="Vendor" required>
            <VendorPicker value={f.vendor?.id} onChange={(v) => set({ vendor: v })} allowRegister />
            {f.vendor && !vendorHasBank(f.vendor) && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-orange">
                <AlertTriangle size={12} /> — no bank details. Add them in the Vendor Register before queueing.
              </div>
            )}
          </Field>
          <Field
            label="Description"
            required
            hint={
              <AiTidyInline
                description={f.description}
                vendorName={f.vendor?.name}
                date={f.date}
                amount={total}
                onChange={(v) => set({ description: v })}
                onSuggest={(s) => {
                  if (!f.payCategoryId) set({ payCategoryId: s.payCategoryId, coaTagId: s.coaTagId, coaTagName: s.coaTagName })
                }}
              />
            }
          >
            <Textarea rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Item – Detail – Qty/Size – DD/MM/YYYY" />
            <DescriptionRulesHint description={f.description} vendorName={f.vendor?.name} />
          </Field>
          <CategoryCoaPicker
            required
            payCategoryId={f.payCategoryId}
            coaTagId={f.coaTagId}
            onChange={(v) => set({ payCategoryId: v.payCategoryId, coaTagId: v.coaTagId, coaTagName: v.coaTagName ?? null })}
          />
          <BuHeadPicker
            required={buRequired}
            costCenterId={f.costCenterId}
            locationId={f.locationId}
            onChange={(v) => set({ costCenterId: v.costCenterId, locationId: v.locationId })}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Units">
              <Input type="number" min={0} step="any" value={f.units} onChange={(e) => set({ units: e.target.value })} />
            </Field>
            <Field label="Unit name">
              <UnitNameSelect value={f.unitName} onChange={(u) => set({ unitName: u })} />
            </Field>
            <Field label="Unit amount" required>
              <Input type="number" min={0} step="any" value={f.unitAmount} onChange={(e) => set({ unitAmount: e.target.value })} />
            </Field>
            <Field label="Total">
              <div className="flex h-11 items-center rounded-xl bg-surface2 px-3 text-sm font-bold tabular-nums">{formatNaira(total)}</div>
            </Field>
          </div>
          <WhtBox
            vendorId={f.vendor?.id}
            coaName={f.coaTagName}
            total={total}
            override={f.whtOverride}
            onOverride={(r) => set({ whtOverride: r })}
            canOverride={canApprove}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Activity month" hint="What month did the related activity happen? (P&L period)">
              <Input type="month" value={f.pnlPeriod} onChange={(e) => set({ pnlPeriod: e.target.value })} />
            </Field>
            <label className="flex cursor-pointer items-center gap-2 self-center pt-4 text-sm">
              <input type="checkbox" className="accent-[var(--gold)]" checked={f.isUrgent} onChange={(e) => set({ isUrgent: e.target.checked })} />
              Mark as urgent
            </label>
          </div>
        </div>
        <ModalFooter>
          {problems.length > 0 && <span className="mr-auto text-[11px] text-text-muted">Needs {problems.join(', ')}</span>}
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={problems.length > 0} isLoading={create.isPending && !dups} onClick={() => create.mutate(false)}>
            Add to Queue
          </Button>
        </ModalFooter>
      </Modal>
      <DuplicateConfirm duplicates={dups} busy={create.isPending} onCancel={() => setDups(null)} onConfirm={() => create.mutate(true)} />
    </>
  )
}
