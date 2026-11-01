import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { BuHeadPicker } from '@/components/shared/BuHeadPicker'
import { CategoryCoaPicker } from '@/components/shared/CategoryCoaPicker'
import { VendorPicker } from '@/components/shared/VendorPicker'
import { UnitNameSelect } from '@/components/shared/UnitNameSelect'
import { DescriptionRulesHint } from '@/components/shared/DescriptionRulesHint'
import { batchKeys, batchesApi } from '@/lib/api/batches'
import { Sheet, naira, withToast } from './shared'

const today = () => new Date().toISOString().slice(0, 10)

/** Log manual expense (spend paid outside the app). The wallet is not affected. */
export function ManualExpenseDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({
    date: today(),
    payCategoryId: null as string | null,
    coaTagId: null as string | null,
    vendorId: null as string | null,
    vendorName: null as string | null,
    description: '',
    pnlPeriod: today().slice(0, 7),
    costCenterId: null as string | null,
    locationId: null as string | null,
    units: '1',
    unitName: '',
    unitAmount: '',
  })
  const [busy, setBusy] = useState(false)
  const units = Number(f.units)
  const unitAmount = Number(f.unitAmount.replace(/,/g, ''))
  const total = Number.isFinite(units) && Number.isFinite(unitAmount) ? Math.round(units * unitAmount * 100) / 100 : 0
  const valid =
    !!f.date && !!f.payCategoryId && !!f.coaTagId && !!f.vendorId && !!f.description.trim() && !!f.costCenterId && !!f.locationId && units > 0 && unitAmount > 0

  const submit = async () => {
    setBusy(true)
    const r = await withToast(
      () =>
        batchesApi.logManualExpense({
          date: f.date,
          payCategoryId: f.payCategoryId!,
          coaTagId: f.coaTagId!,
          vendorId: f.vendorId!,
          description: f.description.trim(),
          pnlPeriod: f.pnlPeriod || undefined,
          costCenterId: f.costCenterId!,
          locationId: f.locationId!,
          units,
          unitName: f.unitName || undefined,
          unitAmount,
        }),
      (x) => `Logged ${naira(x.total)} on ${x.batchRef}`,
    )
    setBusy(false)
    if (r) {
      qc.invalidateQueries({ queryKey: batchKeys.all })
      onClose()
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Log manual expense"
      description="For spend paid outside the app (cash, direct transfer). Creates a paid line marked “Manual entry (paid outside the app)”. The wallet is not affected."
      className="sm:max-w-2xl"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" isLoading={busy} disabled={!valid} onClick={submit}>
            Log expense {total > 0 ? naira(total) : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label required>Date</Label>
            <Input
              type="date"
              value={f.date}
              onChange={(e) => setF((s) => ({ ...s, date: e.target.value, pnlPeriod: s.pnlPeriod || e.target.value.slice(0, 7) }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Activity month</Label>
            <Input type="month" value={f.pnlPeriod} onChange={(e) => setF((s) => ({ ...s, pnlPeriod: e.target.value }))} />
          </div>
        </div>
        <CategoryCoaPicker
          required
          payCategoryId={f.payCategoryId}
          coaTagId={f.coaTagId}
          onChange={(v) => setF((s) => ({ ...s, payCategoryId: v.payCategoryId, coaTagId: v.coaTagId }))}
        />
        <div className="space-y-1.5">
          <Label required>Vendor</Label>
          <VendorPicker value={f.vendorId} onChange={(v) => setF((s) => ({ ...s, vendorId: v?.id ?? null, vendorName: v?.name ?? null }))} />
        </div>
        <div className="space-y-1.5">
          <Label required>Description</Label>
          <Textarea rows={2} maxLength={300} value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} />
          <DescriptionRulesHint description={f.description} vendorName={f.vendorName} />
        </div>
        <BuHeadPicker
          required
          costCenterId={f.costCenterId}
          locationId={f.locationId}
          onChange={(v) => setF((s) => ({ ...s, ...v }))}
        />
        {f.costCenterId && !f.locationId && <p className="-mt-2 text-xs text-text-dim">BU Head is required for manual entries.</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label required>Units</Label>
            <Input inputMode="decimal" value={f.units} onChange={(e) => setF((s) => ({ ...s, units: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Unit name</Label>
            <UnitNameSelect value={f.unitName} onChange={(u) => setF((s) => ({ ...s, unitName: u }))} />
          </div>
          <div className="space-y-1.5">
            <Label required>Unit amount</Label>
            <Input inputMode="decimal" value={f.unitAmount} onChange={(e) => setF((s) => ({ ...s, unitAmount: e.target.value }))} placeholder="₦" />
          </div>
          <div className="space-y-1.5">
            <Label>Total</Label>
            <p className="flex h-11 items-center font-display text-lg font-bold tabular-nums text-gold">{naira(total)}</p>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
