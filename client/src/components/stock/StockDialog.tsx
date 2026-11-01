import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { stockApi } from '@/lib/api/stock'
import { apiError } from '@/lib/api/spend'
import { toNumber } from '@/lib/money'
import { spendKeys } from '@/components/shared/hooks'
import { CategoryCoaPicker } from '@/components/shared/CategoryCoaPicker'
import { VendorPicker } from '@/components/shared/VendorPicker'
import { UnitNameSelect } from '@/components/shared/UnitNameSelect'
import type { StockItem } from '@/types/vendors'

/** New / edit stock item (spec §5.5). */
export function StockDialog({ open, onClose, item }: { open: boolean; onClose: () => void; item: StockItem | null }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [payCategoryId, setPayCategoryId] = useState<string | null>(null)
  const [coaTagId, setCoaTagId] = useState<string | null>(null)
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [unitName, setUnitName] = useState('')
  const [unitAmount, setUnitAmount] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(item?.name ?? '')
    setDescription(item?.description ?? '')
    setPayCategoryId(item?.payCategoryId ?? null)
    setCoaTagId(item?.coaTagId ?? null)
    setVendorId(item?.vendorId ?? null)
    setUnitName(item?.unitName ?? '')
    setUnitAmount(item ? String(toNumber(item.unitAmount)) : '')
    setIsActive(item?.isActive ?? true)
  }, [open, item])

  const save = async () => {
    if (!name.trim()) return toast.error('Name is required')
    const amt = unitAmount.trim() ? Number(unitAmount) : 0
    if (!Number.isFinite(amt) || amt < 0) return toast.error('Unit price must be a positive number')
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      payCategoryId,
      coaTagId,
      vendorId,
      unitName: unitName || undefined,
      unitAmount: amt,
      isActive,
    }
    setSaving(true)
    try {
      if (item) await stockApi.update(item.id, body)
      else await stockApi.create(body)
      toast.success(item ? 'Stock item updated' : 'Stock item added')
      qc.invalidateQueries({ queryKey: spendKeys.stock })
      onClose()
    } catch (e) {
      toast.error(apiError(e, 'Could not save stock item'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={open} onClose={onClose} title={item ? 'Edit stock item' : 'New stock item'} className="max-w-xl">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label required>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Bag of Cement", "Diesel per litre"' />
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Default line description" />
        </div>
        <CategoryCoaPicker
          payCategoryId={payCategoryId}
          coaTagId={coaTagId}
          onChange={(v) => {
            setPayCategoryId(v.payCategoryId)
            setCoaTagId(v.coaTagId)
          }}
        />
        <div className="space-y-1.5">
          <Label>Default vendor</Label>
          <VendorPicker value={vendorId} onChange={(v) => setVendorId(v?.id ?? null)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Unit name</Label>
            <UnitNameSelect value={unitName} onChange={setUnitName} />
          </div>
          <div className="space-y-1.5">
            <Label>Default unit price (₦)</Label>
            <Input value={unitAmount} onChange={(e) => setUnitAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" className="tabular-nums" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active (shown in the picker)
        </label>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} isLoading={saving}>
            {item ? 'Save changes' : 'Add stock item'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
