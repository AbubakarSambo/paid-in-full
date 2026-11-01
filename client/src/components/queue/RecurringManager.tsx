import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { VendorPicker } from '@/components/shared/VendorPicker'
import { CategoryCoaPicker } from '@/components/shared/CategoryCoaPicker'
import { BuHeadPicker } from '@/components/shared/BuHeadPicker'
import { formatDate } from '@/lib/utils'
import { formatNaira, toNumber } from '@/lib/money'
import { recurringApi, recurringKeys } from '@/lib/api/recurring'
import { apiErrorMessage, queueKeys } from '@/lib/api/queue'
import type { RecurringPayment } from '@/types/queue'
import { Chip, Field, ModalFooter } from './common'

interface Form {
  id: string | null
  vendorId: string | null
  description: string
  amount: string
  dayOfMonth: string
  urgentDays: string
  payCategoryId: string | null
  coaTagId: string | null
  costCenterId: string | null
  locationId: string | null
  isActive: boolean
}

const blank = (): Form => ({
  id: null,
  vendorId: null,
  description: '',
  amount: '',
  dayOfMonth: '1',
  urgentDays: '2',
  payCategoryId: null,
  coaTagId: null,
  costCenterId: null,
  locationId: null,
  isActive: true,
})

const fromRow = (r: RecurringPayment): Form => ({
  id: r.id,
  vendorId: r.vendorId,
  description: r.description,
  amount: String(toNumber(r.amount)),
  dayOfMonth: String(r.dayOfMonth),
  urgentDays: String(r.urgentDays),
  payCategoryId: r.payCategoryId,
  coaTagId: r.coaTagId,
  costCenterId: r.costCenterId,
  locationId: r.locationId,
  isActive: r.isActive,
})

/** Recurring payments manager: list + add/edit form + run now (spec §5.2). */
export function RecurringManager({ open, onClose, canPost }: { open: boolean; onClose: () => void; canPost: boolean }) {
  const qc = useQueryClient()
  const { data = [], isLoading } = useQuery({ queryKey: recurringKeys.all, queryFn: recurringApi.list, enabled: open })
  const [form, setForm] = useState<Form | null>(null)
  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f))

  const save = useMutation({
    mutationFn: () => {
      const f = form!
      const body = {
        vendorId: f.vendorId!,
        description: f.description.trim(),
        amount: Number(f.amount),
        dayOfMonth: Number(f.dayOfMonth),
        urgentDays: Number(f.urgentDays),
        payCategoryId: f.payCategoryId!,
        coaTagId: f.coaTagId!,
        costCenterId: f.costCenterId,
        locationId: f.locationId,
        isActive: f.isActive,
      }
      if (!f.id) {
        const { costCenterId, locationId, ...rest } = body
        return recurringApi.create({ ...rest, costCenterId: costCenterId || undefined, locationId: locationId || undefined })
      }
      return recurringApi.update(f.id, body)
    },
    onSuccess: () => {
      toast.success('Recurring payment saved')
      qc.invalidateQueries({ queryKey: recurringKeys.all })
      setForm(null)
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => recurringApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: recurringKeys.all }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  })
  const toggle = useMutation({
    mutationFn: (r: RecurringPayment) => recurringApi.update(r.id, { isActive: !r.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: recurringKeys.all }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  })
  const run = useMutation({
    mutationFn: recurringApi.run,
    onSuccess: (res) => {
      toast.success(`${res.queued} payment${res.queued === 1 ? '' : 's'} queued${res.skippedNoBank ? ` · ${res.skippedNoBank} skipped (no bank details)` : ''}`)
      if (res.errors?.length) toast.error(res.errors.map((e) => `${e.description}: ${e.error}`).join(' · '))
      qc.invalidateQueries({ queryKey: recurringKeys.all })
      qc.invalidateQueries({ queryKey: queueKeys.all })
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })

  const valid =
    form &&
    form.vendorId &&
    form.description.trim() &&
    Number(form.amount) > 0 &&
    Number(form.dayOfMonth) >= 1 &&
    Number(form.dayOfMonth) <= 31 &&
    form.payCategoryId &&
    form.coaTagId

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Recurring payments"
      description="Each payment appears in the queue 7 days before its due date and is marked urgent within N days. It still needs approval and a PIN — nothing is sent automatically."
      className="max-w-3xl"
    >
      {form ? (
        <div className="space-y-4">
          <Field label="Vendor" required>
            <VendorPicker value={form.vendorId} blockNoBank onChange={(v) => set({ vendorId: v?.id ?? null })} />
          </Field>
          <Field label="Description" required hint="The due date is appended automatically, e.g. “Rent – Office – 01/11/2026”.">
            <Input value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Rent – Office" />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Amount" required>
              <Input type="number" step="any" value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
            </Field>
            <Field label="Due day of month" hint="29–31 use the month's last day in shorter months">
              <Input type="number" min={1} max={31} value={form.dayOfMonth} onChange={(e) => set({ dayOfMonth: e.target.value })} />
            </Field>
            <Field label="Mark urgent N days before">
              <Input type="number" min={0} max={27} value={form.urgentDays} onChange={(e) => set({ urgentDays: e.target.value })} />
            </Field>
          </div>
          <CategoryCoaPicker
            required
            payCategoryId={form.payCategoryId}
            coaTagId={form.coaTagId}
            onChange={(v) => set({ payCategoryId: v.payCategoryId, coaTagId: v.coaTagId })}
          />
          <BuHeadPicker costCenterId={form.costCenterId} locationId={form.locationId} onChange={(v) => set(v)} />
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="accent-[var(--gold)]" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
            Active
          </label>
          <ModalFooter>
            <Button variant="outline" size="sm" onClick={() => setForm(null)}>
              Back
            </Button>
            <Button size="sm" disabled={!valid} isLoading={save.isPending} onClick={() => save.mutate()}>
              {form.id ? 'Save changes' : 'Add recurring payment'}
            </Button>
          </ModalFooter>
        </div>
      ) : (
        <>
          {canPost && (
            <div className="mb-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setForm(blank())}>
                <Plus size={14} /> Add recurring payment
              </Button>
              <Button size="sm" variant="outline" isLoading={run.isPending} onClick={() => run.mutate()}>
                <Play size={14} /> Run now
              </Button>
            </div>
          )}
          {isLoading ? (
            <div className="py-8 text-center text-sm text-text-dim">Loading…</div>
          ) : data.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-dim">No recurring payments yet.</div>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border">
              {data.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.description}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-dim">
                      <span>{r.vendor.name}</span>
                      <Chip>Day {r.dayOfMonth}</Chip>
                      {r.payCategory && <Chip>{r.payCategory.name}</Chip>}
                      {r.coaTag && <Chip>{r.coaTag.name}</Chip>}
                      {!r.isActive && <Chip tone="red">Paused</Chip>}
                      {!r.vendorHasBankDetails && <Chip tone="orange">No bank details</Chip>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-text-muted">
                      Next due {formatDate(r.nextDueDate)} · queues {formatDate(r.nextQueueDate)} · urgent {r.urgentDays}d before
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{formatNaira(r.amount)}</span>
                  {canPost && (
                    <div className="flex items-center gap-1">
                      <button
                        className="rounded-md px-2 py-1 text-[11px] font-semibold text-text-dim hover:bg-surface2"
                        onClick={() => toggle.mutate(r)}
                      >
                        {r.isActive ? 'Pause' : 'Resume'}
                      </button>
                      <button className="rounded-md p-1.5 text-text-dim hover:bg-surface2" onClick={() => setForm(fromRow(r))} aria-label="Edit">
                        <Pencil size={14} />
                      </button>
                      <button
                        className="rounded-md p-1.5 text-text-dim hover:text-red"
                        onClick={() => window.confirm(`Delete “${r.description}”?`) && remove.mutate(r.id)}
                        aria-label="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <ModalFooter>
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  )
}
