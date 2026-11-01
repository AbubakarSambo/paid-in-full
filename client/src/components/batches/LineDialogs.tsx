import { useState } from 'react'
import { Info, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { BuHeadPicker } from '@/components/shared/BuHeadPicker'
import { CategoryCoaPicker } from '@/components/shared/CategoryCoaPicker'
import { VendorPicker } from '@/components/shared/VendorPicker'
import { toNumber } from '@/lib/money'
import { batchesApi } from '@/lib/api/batches'
import type { BatchLine, ReclassifyInput } from '@/types/batches'
import { LineStatusPill, MicroLabel, Sheet, fmtDateTime, kobo, naira, nairaExact, parseAmount, withToast } from './shared'

/** Details + reclassify (BU, BU head, COA, P&L period, vendor, description). */
export function LineDetailsDialog({
  batchId,
  line,
  canEdit,
  canResync,
  onClose,
  onSaved,
}: {
  batchId: string
  line: BatchLine
  canEdit: boolean
  canResync: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [f, setF] = useState({
    costCenterId: line.costCenterId,
    locationId: line.locationId,
    payCategoryId: line.payCategoryId,
    coaTagId: line.coaTagId,
    pnlPeriod: line.pnlPeriod ?? '',
    vendorId: line.vendorId,
    description: line.description,
  })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [resyncing, setResyncing] = useState(false)
  const editable = canEdit && line.payoutStatus !== 'CANCELLED'
  const vendorLocked = line.paid > 0 || line.payouts.some((p) => p.status === 'PENDING' || p.status === 'PROCESSING')

  const diff: ReclassifyInput = {}
  if (f.costCenterId && f.costCenterId !== line.costCenterId) diff.costCenterId = f.costCenterId
  if (f.locationId !== line.locationId && (f.costCenterId === line.costCenterId || f.locationId)) diff.locationId = f.locationId
  if (f.coaTagId && f.coaTagId !== line.coaTagId) diff.coaTagId = f.coaTagId
  if (f.pnlPeriod && f.pnlPeriod !== line.pnlPeriod) diff.pnlPeriod = f.pnlPeriod
  if (f.vendorId && f.vendorId !== line.vendorId) diff.vendorId = f.vendorId
  if (f.description.trim() && f.description.trim() !== line.description) diff.description = f.description.trim()
  const changed = Object.keys(diff).length > 0
  const coaIncomplete = !!f.payCategoryId && f.payCategoryId !== line.payCategoryId && !f.coaTagId

  const save = async () => {
    setBusy(true)
    const r = await withToast(() => batchesApi.reclassify(batchId, line.id, diff), 'Line updated')
    setBusy(false)
    if (r) {
      setSaved(true)
      onSaved()
    }
  }

  const resync = async () => {
    setResyncing(true)
    await withToast(() => batchesApi.resyncSheet(batchId), 'Sheet resynced')
    setResyncing(false)
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Line details"
      description={
        <span className="flex flex-wrap items-center gap-2">
          {line.vendorName} <LineStatusPill line={line} />
        </span>
      }
      className="sm:max-w-2xl"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            {saved ? 'Close' : 'Cancel'}
          </Button>
          {editable && (
            <Button size="sm" isLoading={busy} disabled={!changed || coaIncomplete} onClick={save}>
              Save changes
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-secondary/50 p-3 text-sm sm:grid-cols-4">
        <Fact label="Total" value={nairaExact(line.total)} />
        <Fact label="WHT" value={`${naira(line.whtAmount)}${toNumber(line.whtRate) > 0 ? ` (${Math.round(toNumber(line.whtRate) * 1000) / 10}%)` : ''}`} />
        <Fact label="Paid" value={nairaExact(line.paid)} />
        <Fact label="Outstanding" value={nairaExact(line.outstanding)} />
        <Fact label="Bank · Account" value={`${line.vendorBank ?? '—'} · ${line.vendorAcctNo ?? '—'}`} wide />
        <Fact label="Account name" value={line.vendorAcctName ?? '—'} wide />
      </div>
      {!line.vendorBankCode && (
        <p className="mt-2 text-xs text-red">No bank code mapped — payouts will fail for this vendor.</p>
      )}

      {!canEdit && <p className="mt-4 text-xs text-text-dim">Read-only — Approver role required to reclassify.</p>}

      <div className="mt-4 space-y-4">
        <BuHeadPicker
          costCenterId={f.costCenterId}
          locationId={f.locationId}
          disabled={!editable}
          onChange={(v) => setF((s) => ({ ...s, ...v }))}
        />
        <CategoryCoaPicker
          payCategoryId={f.payCategoryId}
          coaTagId={f.coaTagId}
          disabled={!editable}
          onChange={(v) => setF((s) => ({ ...s, payCategoryId: v.payCategoryId, coaTagId: v.coaTagId }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>P&L period</Label>
            <Input type="month" value={f.pnlPeriod} disabled={!editable} onChange={(e) => setF((s) => ({ ...s, pnlPeriod: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Vendor</Label>
            <VendorPicker
              value={f.vendorId}
              disabled={!editable || vendorLocked}
              onChange={(v) => v && setF((s) => ({ ...s, vendorId: v.id }))}
            />
            {vendorLocked && <p className="text-xs text-text-dim">The vendor can't change after part of the line was paid or sent.</p>}
            {!vendorLocked && f.vendorId !== line.vendorId && (
              <p className="text-xs text-orange">Bank details will be re-copied from the vendor register.</p>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea rows={2} value={f.description} disabled={!editable} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} />
        </div>
        {coaIncomplete && <p className="text-xs text-red">Pick a COA tag in the new category.</p>}
        {editable && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue/30 bg-blue/10 px-3 py-2 text-xs text-blue">
            <span className="flex items-center gap-1.5">
              <Info size={14} /> Resync the sheet afterwards so the Mastersheet matches.
            </span>
            {saved && canResync && (
              <Button size="sm" variant="outline" isLoading={resyncing} onClick={resync}>
                <RefreshCw size={12} /> Resync sheet
              </Button>
            )}
          </div>
        )}
      </div>

      {line.payouts.length > 0 && (
        <div className="mt-5">
          <MicroLabel className="mb-2">Payout ledger</MicroLabel>
          <ul className="divide-y divide-border rounded-xl border border-border text-xs">
            {line.payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="font-semibold">{p.leg === 'WHT' ? 'WHT' : 'Vendor'}</span>
                <span className="font-mono tabular-nums">{nairaExact(p.amount)}</span>
                <span className={p.status === 'SUCCESS' ? 'text-green' : p.status === 'FAILED' || p.status === 'REVERSED' ? 'text-red' : 'text-purple'}>
                  {p.status}
                </span>
                <span className="truncate font-mono text-text-muted">{p.reference}</span>
                <span className="text-text-dim">{fmtDateTime(p.completedAt ?? p.createdAt)}</span>
                {p.failureReason && <span className="w-full text-text-dim">{p.failureReason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  )
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <MicroLabel>{label}</MicroLabel>
      <p className="mt-0.5 truncate font-medium tabular-nums">{value}</p>
    </div>
  )
}

/** Split line: keep part on this line (pay now), the remainder becomes a new line (pay later). */
export function SplitLineDialog({ batchId, line, onClose, onDone }: { batchId: string; line: BatchLine; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState(`${line.description} (balance)`)
  const [busy, setBusy] = useState(false)
  const value = parseAmount(amount)
  const valid = Number.isFinite(value) && value > 0 && kobo(line.outstanding - value) >= 100
  const remainder = valid ? Math.round((line.outstanding - value) * 100) / 100 : null

  const submit = async () => {
    setBusy(true)
    const r = await withToast(
      () => batchesApi.splitLine(batchId, line.id, { payNowAmount: value, remainderDescription: desc.trim() || undefined }),
      (x) => `Split: ${naira(x.payNow)} now, ${naira(x.remainder)} later`,
    )
    setBusy(false)
    if (r) onDone()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Split line"
      description={`${line.vendorName} · outstanding ${nairaExact(line.outstanding)}`}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" isLoading={busy} disabled={!valid} onClick={submit}>
            Split line
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label required>Pay now</Label>
          <Input
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="font-mono tabular-nums"
            error={amount && !valid ? `Must leave at least ₦1 of the ${nairaExact(line.outstanding)} outstanding` : undefined}
          />
          {remainder !== null && <p className="text-xs text-text-dim">A new line for {nairaExact(remainder)} will be added to this batch (pay later).</p>}
        </div>
        <div className="space-y-1.5">
          <Label>Description for the remainder line</Label>
          <Input value={desc} maxLength={200} onChange={(e) => setDesc(e.target.value)} />
        </div>
      </div>
    </Sheet>
  )
}
