import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Paperclip, Plus, X } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { VendorPicker } from '@/components/shared/VendorPicker'
import { BuHeadPicker } from '@/components/shared/BuHeadPicker'
import { UnitNameSelect } from '@/components/shared/UnitNameSelect'
import { DescriptionRulesHint } from '@/components/shared/DescriptionRulesHint'
import { validateDescription } from '@/components/shared/descriptionRules'
import { useBanks } from '@/components/shared/hooks'
import { formatNaira } from '@/lib/money'
import { requisitionKeys, requisitionsApi } from '@/lib/api/requisitions'
import { apiErrorMessage, apiErrors } from '@/lib/api/queue'
import type { DescriptionIssue, RequisitionHeaderPayload, RequisitionRow } from '@/types/requisitions'
import type { Vendor } from '@/types/vendors'
import { Field, ModalFooter, todayISO, useQueueLookups } from '@/components/queue/common'
import { StockSelect, useAiTidy } from '@/components/queue/helpers'
import { ReviewDescriptionsDialog } from '@/components/shared/ReviewDescriptionsDialog'
import { IssuesList } from './shared'

interface Item {
  key: number
  description: string
  units: string
  unitName: string
  unitAmount: string
  files: File[]
}

let seq = 1
const newItem = (): Item => ({ key: seq++, description: '', units: '1', unitName: '', unitAmount: '', files: [] })
const itemTotal = (i: Item) => Math.round((Number(i.units) || 0) * (Number(i.unitAmount) || 0) * 100) / 100

function FilePick({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className="inline-flex items-center gap-1 text-[11px] font-semibold text-gold hover:underline" onClick={() => ref.current?.click()}>
        <Paperclip size={12} /> Attach quote / pro-forma
      </button>
      {files.map((f, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-md bg-surface2 px-1.5 py-0.5 text-[11px]">
          {f.name}
          <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} className="text-text-muted hover:text-red">
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        type="file"
        multiple
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? [])
          e.target.value = ''
          const tooBig = picked.filter((f) => f.size > 10 * 1024 * 1024)
          if (tooBig.length) toast.error('Files must be 10 MB or smaller')
          onChange([...files, ...picked.filter((f) => f.size <= 10 * 1024 * 1024)])
        }}
      />
    </div>
  )
}

export function RequisitionForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (first: RequisitionRow | null) => void }) {
  const qc = useQueryClient()
  const { buRequired } = useQueueLookups()
  const { data: banks = [] } = useBanks()
  const [date, setDate] = useState(todayISO())
  const [department, setDepartment] = useState('')
  const [isNewVendor, setIsNewVendor] = useState(false)
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [nv, setNv] = useState({ name: '', acctName: '', bankCode: '', acctNo: '' })
  const [isBundle, setIsBundle] = useState(false)
  const [bundleLabel, setBundleLabel] = useState('')
  const [items, setItems] = useState<Item[]>([newItem()])
  const [bu, setBu] = useState<{ costCenterId: string | null; locationId: string | null }>({ costCenterId: null, locationId: null })
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')
  const [issues, setIssues] = useState<DescriptionIssue[]>([])
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null)
  const ai = useAiTidy()
  const reviewSaved = useRef(false)

  const { data: suggestions = [] } = useQuery({
    queryKey: ['departments', 'suggestions', department],
    queryFn: () => requisitionsApi.departmentSuggestions(department),
    enabled: open,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!open) return
    setDate(todayISO())
    setDepartment('')
    setIsNewVendor(false)
    setVendor(null)
    setNv({ name: '', acctName: '', bankCode: '', acctNo: '' })
    setIsBundle(false)
    setBundleLabel('')
    setItems([newItem()])
    setBu({ costCenterId: null, locationId: null })
    setReason('')
    setRemarks('')
    setIssues([])
  }, [open])

  const setItem = (key: number, patch: Partial<Item>) => setItems((is) => is.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  const active = isBundle ? items : items.slice(0, 1)
  const total = active.reduce((s, i) => s + itemTotal(i), 0)
  const vendorName = isNewVendor ? nv.name : vendor?.name ?? ''

  const header = (submit: boolean): RequisitionHeaderPayload => {
    const bank = banks.find((b) => b.code === nv.bankCode)
    return {
      date,
      departmentName: department.trim() || undefined,
      ...(isNewVendor
        ? {
            isNewVendor: true,
            vendorName: nv.name.trim() || undefined,
            vendorAcctName: nv.acctName.trim() || undefined,
            vendorBankCode: nv.bankCode || undefined,
            vendorBank: bank?.name,
            vendorAcctNo: /^\d{10}$/.test(nv.acctNo) ? nv.acctNo : undefined,
          }
        : { isNewVendor: false, vendorId: vendor?.id }),
      costCenterId: bu.costCenterId || undefined,
      locationId: bu.locationId || undefined,
      reason: reason.trim() || undefined,
      remarks: remarks.trim() || undefined,
      submit,
    }
  }

  const localIssues = (list: Item[]): DescriptionIssue[] => {
    const out: DescriptionIssue[] = []
    list.forEach((i, idx) => {
      const msgs = [...validateDescription(i.description, vendorName)]
      if (!(Number(i.unitAmount) > 0)) msgs.push('Unit amount must be greater than 0.')
      if (msgs.length) out.push({ id: String(idx), description: i.description, issues: msgs })
    })
    const head: string[] = []
    if (isNewVendor) {
      if (!nv.name.trim()) head.push('Vendor name is required.')
      if (!nv.acctName.trim()) head.push('Account name is required.')
      if (!nv.bankCode) head.push('Bank is required.')
      if (!/^\d{10}$/.test(nv.acctNo)) head.push('Account number must be 10 digits.')
    } else if (!vendor) head.push('Pick a vendor from the register, or switch on "New vendor".')
    if (buRequired && (!bu.costCenterId || !bu.locationId)) head.push('Business Unit and BU Head are required.')
    if (isBundle && !bundleLabel.trim()) head.push('Bundle name is required.')
    if (head.length) out.unshift({ id: 'header', description: 'Requisition details', issues: head })
    return out
  }

  const persist = async (submit: boolean, list: Item[]) => {
    setBusy(submit ? 'submit' : 'draft')
    setIssues([])
    try {
      // Create as a draft first so attachments can be added, then submit.
      let rows: RequisitionRow[]
      if (isBundle) {
        rows = await requisitionsApi.createBundle({
          ...header(false),
          bundleLabel: bundleLabel.trim(),
          items: list.map((i) => ({ description: i.description.trim(), units: Number(i.units) || 1, unitName: i.unitName || undefined, unitAmount: Number(i.unitAmount) })),
        })
      } else {
        const i = list[0]
        rows = [
          await requisitionsApi.create({
            ...header(false),
            description: i.description.trim(),
            units: Number(i.units) || 1,
            unitName: i.unitName || undefined,
            unitAmount: Number(i.unitAmount),
          }),
        ]
      }
      for (let idx = 0; idx < rows.length; idx++) {
        for (const f of list[idx]?.files ?? []) {
          try {
            await requisitionsApi.uploadAttachment(rows[idx].id, f)
          } catch (e) {
            toast.error(`${f.name}: ${apiErrorMessage(e, 'upload failed')}`)
          }
        }
      }
      qc.invalidateQueries({ queryKey: requisitionKeys.all })
      if (submit) {
        try {
          await requisitionsApi.submit(rows[0].id, { wholeBundle: isBundle })
        } catch (e) {
          const srv = apiErrors<{ issues?: DescriptionIssue[] }>(e)?.issues
          if (srv?.length) setIssues(srv)
          toast.error(`Saved as a draft, but it couldn't be submitted: ${apiErrorMessage(e)}`)
          qc.invalidateQueries({ queryKey: requisitionKeys.all })
          onSaved?.(rows[0] ?? null)
          return
        }
        toast.success(isBundle ? `Bundle submitted (${rows.length} items)` : 'Requisition submitted')
      } else {
        toast.success('Draft saved')
      }
      qc.invalidateQueries({ queryKey: requisitionKeys.all })
      onClose()
    } catch (e) {
      const srv = apiErrors<{ issues?: DescriptionIssue[] }>(e)?.issues
      if (srv?.length) setIssues(srv)
      toast.error(apiErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const saveDraft = () => {
    if (!active.some((i) => i.description.trim())) return toast.error('Add a description first')
    if (active.some((i) => !(Number(i.unitAmount) > 0))) return toast.error('Every item needs a unit amount')
    void persist(false, active)
  }

  // Submit: tidy with AI → review → validate against Description Rules → save + submit.
  const submit = async () => {
    const results = await ai.run(active.map((i) => ({ id: String(i.key), description: i.description, vendorName: vendorName || undefined, date, amount: itemTotal(i) })))
    // No AI changes (or AI unavailable): validate and submit as typed.
    if (!results || !results.some((r) => r.changed)) {
      ai.setResults(null)
      continueSubmit(active)
    }
  }
  const continueSubmit = (list: Item[]) => {
    const found = localIssues(list)
    if (found.length) {
      setIssues(found)
      return
    }
    void persist(true, list)
  }

  return (
    <>
      <Modal isOpen={open} onClose={onClose} title="New requisition" description="Staff raise requests, procurement clears them, accounts push to the payment queue." className="max-w-3xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Department">
              <Input list="req-departments" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Kitchen" />
              <datalist id="req-departments">
                {suggestions.map((s) => (
                  <option key={s.name} value={s.name} />
                ))}
              </datalist>
            </Field>
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="accent-[var(--gold)]" checked={isNewVendor} onChange={(e) => setIsNewVendor(e.target.checked)} />
            New vendor (not yet on file)
          </label>
          {isNewVendor ? (
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
              <Field label="Vendor name" required>
                <Input value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} />
              </Field>
              <Field label="Account name" required>
                <Input value={nv.acctName} onChange={(e) => setNv({ ...nv, acctName: e.target.value })} />
              </Field>
              <Field label="Bank" required>
                <Select value={nv.bankCode} onChange={(e) => setNv({ ...nv, bankCode: e.target.value })}>
                  <option value="">Select bank…</option>
                  {banks.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Account number" required hint={nv.acctNo && !/^\d{10}$/.test(nv.acctNo) ? <span className="text-orange">10 digits required</span> : undefined}>
                <Input inputMode="numeric" maxLength={10} value={nv.acctNo} onChange={(e) => setNv({ ...nv, acctNo: e.target.value.replace(/\D/g, '') })} />
              </Field>
            </div>
          ) : (
            <Field label="Vendor" required hint="Vendors without bank details can't be used.">
              <VendorPicker value={vendor?.id} onChange={setVendor} blockNoBank />
            </Field>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="accent-[var(--gold)]" checked={isBundle} onChange={(e) => setIsBundle(e.target.checked)} />
            Bundle — several items from this vendor
          </label>
          {isBundle && (
            <Field label="Bundle name" required>
              <Input value={bundleLabel} onChange={(e) => setBundleLabel(e.target.value)} placeholder="e.g. Bar restock – November" />
            </Field>
          )}

          <div className="space-y-3">
            {active.map((i, idx) => (
              <div key={i.key} className="space-y-2 rounded-xl border border-border p-3">
                {isBundle && (
                  <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-text-dim">
                    Item {idx + 1}
                    {items.length > 1 && (
                      <button className="text-text-muted hover:text-red" onClick={() => setItems((is) => is.filter((x) => x.key !== i.key))} aria-label="Remove item">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Field label="Description" required>
                      <Input value={i.description} onChange={(e) => setItem(i.key, { description: e.target.value })} placeholder="Item – Detail – Qty/Size – DD/MM/YYYY" />
                    </Field>
                    <DescriptionRulesHint description={i.description} vendorName={vendorName} />
                  </div>
                  <Field label="Pick stock item">
                    <StockSelect
                      onPick={(s) => setItem(i.key, { description: s.description || s.name, unitName: s.unitName ?? '', unitAmount: String(Number(s.unitAmount) || '') })}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Field label="Unit">
                    <UnitNameSelect value={i.unitName} onChange={(u) => setItem(i.key, { unitName: u })} />
                  </Field>
                  <Field label="Qty">
                    <Input type="number" step="any" value={i.units} onChange={(e) => setItem(i.key, { units: e.target.value })} />
                  </Field>
                  <Field label="Unit amount" required>
                    <Input type="number" step="any" value={i.unitAmount} onChange={(e) => setItem(i.key, { unitAmount: e.target.value })} />
                  </Field>
                  <Field label="Total">
                    <div className="flex h-11 items-center rounded-xl bg-surface2 px-3 text-sm font-bold tabular-nums">{formatNaira(itemTotal(i))}</div>
                  </Field>
                </div>
                <FilePick files={i.files} onChange={(files) => setItem(i.key, { files })} />
              </div>
            ))}
            {isBundle && (
              <div className="flex items-center justify-between">
                <button className="inline-flex items-center gap-1 text-xs font-semibold text-gold" onClick={() => setItems((is) => [...is, newItem()])}>
                  <Plus size={12} /> Add item
                </button>
                <span className="text-sm">
                  Total <span className="font-bold tabular-nums">{formatNaira(total)}</span>
                </span>
              </div>
            )}
          </div>

          <BuHeadPicker required={buRequired} costCenterId={bu.costCenterId} locationId={bu.locationId} onChange={setBu} />
          <Field label="Reason for the request">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="Remarks">
            <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          <IssuesList issues={issues} />
        </div>
        <ModalFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" size="sm" isLoading={busy === 'draft'} disabled={!!busy} onClick={saveDraft}>
            Save draft
          </Button>
          <Button size="sm" isLoading={busy === 'submit' || ai.busy} disabled={!!busy} onClick={submit}>
            Submit
          </Button>
        </ModalFooter>
      </Modal>
      <ReviewDescriptionsDialog
        open={!!ai.results}
        results={ai.results ?? []}
        vendorNames={Object.fromEntries(active.map((i) => [String(i.key), vendorName || undefined]))}
        onClose={() => {
          // The dialog calls onClose after onSave too; only a plain close continues with the originals.
          if (reviewSaved.current) {
            reviewSaved.current = false
            return
          }
          ai.setResults(null)
          continueSubmit(active)
        }}
        onSave={(res) => {
          reviewSaved.current = true
          const byKey = new Map(res.map((r) => [r.id, r.description]))
          const next = items.map((i) => (byKey.has(String(i.key)) ? { ...i, description: byKey.get(String(i.key))! } : i))
          setItems(next)
          ai.setResults(null)
          continueSubmit(isBundle ? next : next.slice(0, 1))
        }}
      />
    </>
  )
}
