import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Paperclip, Send, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { VendorPicker } from '@/components/shared/VendorPicker'
import { CategoryCoaPicker } from '@/components/shared/CategoryCoaPicker'
import { BuHeadPicker } from '@/components/shared/BuHeadPicker'
import { UnitNameSelect } from '@/components/shared/UnitNameSelect'
import { DescriptionRulesHint } from '@/components/shared/DescriptionRulesHint'
import { formatNaira, toNumber } from '@/lib/money'
import { formatDateTime } from '@/lib/utils'
import { apiErrorMessage, queueApi, queueKeys } from '@/lib/api/queue'
import type { QueueItemDetail, UpdateQueueItemPayload } from '@/types/queue'
import { Chip, Field, ModalFooter, isoDate } from './common'
import { AiTidyInline, WhtBox, saveBlob } from './helpers'

interface Edit {
  date: string
  vendorId: string
  vendorName: string
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
  bundleLabel: string
  whtOverride: number | null
}

const fromItem = (i: QueueItemDetail): Edit => ({
  date: isoDate(i.date),
  vendorId: i.vendorId,
  vendorName: i.vendor?.name ?? i.vendorName ?? '',
  description: i.description,
  payCategoryId: i.payCategoryId,
  coaTagId: i.coaTagId,
  coaTagName: i.coaTag,
  costCenterId: i.costCenterId,
  locationId: i.locationId,
  units: String(toNumber(i.units)),
  unitName: i.unitName ?? '',
  unitAmount: String(toNumber(i.unitAmount)),
  pnlPeriod: i.pnlPeriod ?? '',
  isUrgent: i.isUrgent,
  bundleLabel: i.bundleLabel ?? '',
  whtOverride: i.whtOverride ? toNumber(i.whtRate) : null,
})

export function ItemDetailsModal({
  itemId,
  onClose,
  canPost,
  canApprove,
  buRequired,
}: {
  itemId: string | null
  onClose: () => void
  canPost: boolean
  canApprove: boolean
  buRequired: boolean
}) {
  const qc = useQueryClient()
  const { data: item, isLoading } = useQuery({
    queryKey: queueKeys.item(itemId ?? ''),
    queryFn: () => queueApi.get(itemId!),
    enabled: !!itemId,
  })
  const [e, setE] = useState<Edit | null>(null)
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [changingVendor, setChangingVendor] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (item) setE(fromItem(item))
    setReason('')
    setChangingVendor(false)
  }, [item])

  const editable = canPost && item?.status === 'PENDING'
  const set = (patch: Partial<Edit>) => setE((s) => (s ? { ...s, ...patch } : s))
  const refresh = () => {
    qc.invalidateQueries({ queryKey: queueKeys.all })
  }

  const units = Number(e?.units) || 0
  const unitAmount = Number(e?.unitAmount) || 0
  const total = Math.round(units * unitAmount * 100) / 100
  const oldTotal = toNumber(item?.total)
  const amountChanged = !!item && Math.abs(total - oldTotal) > 0.004

  const diff = (): UpdateQueueItemPayload => {
    if (!item || !e) return {}
    const o = fromItem(item)
    const p: UpdateQueueItemPayload = {}
    if (e.date !== o.date) p.date = e.date
    if (e.vendorId !== o.vendorId) p.vendorId = e.vendorId
    if (e.description.trim() !== o.description) p.description = e.description.trim()
    if (e.payCategoryId !== o.payCategoryId && e.payCategoryId) p.payCategoryId = e.payCategoryId
    if (e.coaTagId !== o.coaTagId && e.coaTagId) p.coaTagId = e.coaTagId
    if (e.costCenterId !== o.costCenterId) p.costCenterId = e.costCenterId
    if (e.locationId !== o.locationId) p.locationId = e.locationId
    if (Number(e.units) !== Number(o.units)) p.units = units
    if (e.unitName !== o.unitName) p.unitName = e.unitName
    if (Number(e.unitAmount) !== Number(o.unitAmount)) p.unitAmount = unitAmount
    if (e.pnlPeriod !== o.pnlPeriod && e.pnlPeriod) p.pnlPeriod = e.pnlPeriod
    if (e.isUrgent !== o.isUrgent) p.isUrgent = e.isUrgent
    if (item.bundleId && e.bundleLabel.trim() && e.bundleLabel.trim() !== o.bundleLabel) p.bundleLabel = e.bundleLabel.trim()
    if (canApprove && e.whtOverride !== o.whtOverride) p.whtRateOverride = e.whtOverride
    if (amountChanged) p.amountChangeReason = reason.trim()
    return p
  }
  const changes = diff()
  const dirty = Object.keys(changes).filter((k) => k !== 'amountChangeReason').length > 0

  const save = useMutation({
    mutationFn: () => queueApi.update(item!.id, changes),
    onSuccess: () => {
      toast.success('Saved')
      refresh()
      onClose()
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const post = useMutation({
    mutationFn: () => queueApi.addComment(item!.id, comment.trim()),
    onSuccess: () => {
      setComment('')
      qc.invalidateQueries({ queryKey: queueKeys.item(item!.id) })
      refresh()
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const upload = useMutation({
    mutationFn: (file: File) => queueApi.uploadAttachment(item!.id, file),
    onSuccess: () => {
      toast.success('File attached')
      qc.invalidateQueries({ queryKey: queueKeys.item(item!.id) })
      refresh()
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const removeFile = useMutation({
    mutationFn: (id: string) => queueApi.removeAttachment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queueKeys.item(item!.id) }),
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const download = async (id: string, name: string) => {
    try {
      saveBlob(await queueApi.downloadAttachment(id), name)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Download failed'))
    }
  }

  return (
    <Modal isOpen={!!itemId} onClose={onClose} title="Queue item details" className="max-w-3xl">
      {isLoading || !item || !e ? (
        <div className="py-10 text-center text-sm text-text-dim">Loading…</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-text-muted">#{item.id.slice(0, 8).toUpperCase()}</span>
            <Chip tone={item.status === 'PENDING' ? 'blue' : item.status === 'APPROVED' ? 'green' : 'red'}>{item.status}</Chip>
            {item.bundleId && <Chip tone="gold">Bundle</Chip>}
            {item.batchRef && <Chip tone="green">{item.batchRef}</Chip>}
            {!canPost && <span className="text-[11px] text-text-muted">Read-only — Poster role required to edit</span>}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Vendor">
              {changingVendor ? (
                <VendorPicker
                  value={e.vendorId}
                  blockNoBank
                  onChange={(v) => {
                    if (v) set({ vendorId: v.id, vendorName: v.name })
                    setChangingVendor(false)
                  }}
                />
              ) : (
                <div className="flex h-11 items-center rounded-xl bg-surface2 px-3 text-sm font-medium">{e.vendorName}</div>
              )}
            </Field>
            <Field label="Date">
              <Input type="date" value={e.date} disabled={!editable} onChange={(ev) => set({ date: ev.target.value })} />
            </Field>
          </div>

          <div className="rounded-xl border border-border bg-surface2/50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm">
                {e.vendorId !== item.vendorId ? (
                  <div className="text-text-dim">New vendor selected — bank details will be read from the register on save.</div>
                ) : item.bankDetails.accountNumber ? (
                  <>
                    <div className="font-medium">{item.bankDetails.accountName ?? '—'}</div>
                    <div className="text-text-dim tabular-nums">
                      {item.bankDetails.bankName} · {item.bankDetails.accountNumber}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[11px]">
                      {item.bankDetails.verified ? (
                        <span className="flex items-center gap-1 text-green">
                          <CheckCircle2 size={12} /> Verified
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-orange">
                          <AlertTriangle size={12} /> Not verified
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-orange">No bank details on this vendor</div>
                )}
              </div>
              {editable && (
                <Button size="sm" variant="outline" onClick={() => setChangingVendor(true)}>
                  Change vendor
                </Button>
              )}
            </div>
            <p className="mt-2 text-[11px] text-text-muted">
              Bank details come from the Vendor Register at approval time — edit the vendor there to change them.
            </p>
          </div>

          <Field
            label="Description"
            hint={
              editable && (
                <AiTidyInline description={e.description} vendorName={e.vendorName} date={e.date} amount={total} onChange={(v) => set({ description: v })} />
              )
            }
          >
            <Textarea rows={2} value={e.description} disabled={!editable} onChange={(ev) => set({ description: ev.target.value })} />
            {editable && <DescriptionRulesHint description={e.description} vendorName={e.vendorName} showOk={false} />}
          </Field>

          {item.bundleId && (
            <Field label="Bundle name" hint="Applies to all lines in the bundle">
              <Input value={e.bundleLabel} disabled={!editable} onChange={(ev) => set({ bundleLabel: ev.target.value })} />
            </Field>
          )}

          <BuHeadPicker
            required={buRequired}
            disabled={!editable}
            costCenterId={e.costCenterId}
            locationId={e.locationId}
            onChange={(v) => set({ costCenterId: v.costCenterId, locationId: v.locationId })}
          />
          <CategoryCoaPicker
            required
            disabled={!editable}
            payCategoryId={e.payCategoryId}
            coaTagId={e.coaTagId}
            onChange={(v) => set({ payCategoryId: v.payCategoryId, coaTagId: v.coaTagId, coaTagName: v.coaTagName ?? null })}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Units">
              <Input type="number" step="any" value={e.units} disabled={!editable} onChange={(ev) => set({ units: ev.target.value })} />
            </Field>
            <Field label="Unit name">
              <UnitNameSelect value={e.unitName} disabled={!editable} onChange={(u) => set({ unitName: u })} />
            </Field>
            <Field label="Unit amount">
              <Input type="number" step="any" value={e.unitAmount} disabled={!editable} onChange={(ev) => set({ unitAmount: ev.target.value })} />
            </Field>
            <Field label="Total">
              <div className="flex h-11 items-center rounded-xl bg-surface2 px-3 text-sm font-bold tabular-nums">{formatNaira(total)}</div>
            </Field>
          </div>
          {amountChanged && editable && (
            <Field label="Reason for amount change" required hint={`Was ${formatNaira(oldTotal)} → now ${formatNaira(total)}. Both are logged to the audit log.`}>
              <Input value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Vendor revised the invoice" />
            </Field>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="P&L period">
              <Input type="month" value={e.pnlPeriod} disabled={!editable} onChange={(ev) => set({ pnlPeriod: ev.target.value })} />
            </Field>
            <div className="space-y-1 pt-1 text-[12px] text-text-dim">
              <div>Added by: <span className="text-foreground">{item.createdByName ?? '—'}</span></div>
              {(item.requisition || item.requestedByName) && (
                <div>
                  Requisitioned by: <span className="text-foreground">{item.requisition?.requesterName ?? item.requestedByName}</span>
                  {item.requisition?.reqRef ? ` (${item.requisition.reqRef})` : ''}
                </div>
              )}
              {item.approvedByName && <div>Approved by: <span className="text-foreground">{item.approvedByName}</span></div>}
            </div>
          </div>

          <WhtBox
            vendorId={e.vendorId}
            coaName={e.coaTagName}
            total={total}
            override={e.whtOverride}
            onOverride={(r) => set({ whtOverride: r })}
            canOverride={canApprove && editable}
          />

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="accent-[var(--gold)]" disabled={!editable} checked={e.isUrgent} onChange={(ev) => set({ isUrgent: ev.target.checked })} />
            Mark as urgent
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">Attachments</div>
              {canPost && (
                <>
                  <Button size="sm" variant="outline" isLoading={upload.isPending} onClick={() => fileRef.current?.click()}>
                    <Paperclip size={14} /> Add file
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={(ev) => {
                      const file = ev.target.files?.[0]
                      ev.target.value = ''
                      if (!file) return
                      if (file.size > 10 * 1024 * 1024) return void toast.error('Files must be 10 MB or smaller')
                      upload.mutate(file)
                    }}
                  />
                </>
              )}
            </div>
            {item.attachments.length === 0 ? (
              <div className="text-xs text-text-muted">No files. PDF or images, up to 10 MB each.</div>
            ) : (
              <div className="space-y-1">
                {item.attachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
                    <Paperclip size={13} className="text-text-dim" />
                    <span className="min-w-0 flex-1 truncate">{a.fileName}</span>
                    {a.sizeBytes ? <span className="text-[11px] text-text-muted">{Math.round(a.sizeBytes / 1024)} KB</span> : null}
                    <button className="p-1 text-text-dim hover:text-foreground" title="Download" onClick={() => download(a.id, a.fileName)}>
                      <Download size={14} />
                    </button>
                    {canPost && (
                      <button className="p-1 text-text-dim hover:text-red" title="Remove" onClick={() => removeFile.mutate(a.id)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">Comments</div>
            <p className="mb-2 text-[11px] text-text-muted">Visible to everyone in this organisation.</p>
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {item.comments.length === 0 && <div className="text-xs text-text-muted">No comments yet.</div>}
              {item.comments.map((c) => (
                <div key={c.id} className="rounded-lg bg-surface2 px-3 py-2 text-sm">
                  <div className="text-[11px] text-text-dim">
                    <span className="font-semibold text-foreground">{c.authorName ?? 'Someone'}</span> · {formatDateTime(c.createdAt)}
                  </div>
                  <div className="whitespace-pre-wrap">{c.body}</div>
                </div>
              ))}
            </div>
            {canPost && (
              <div className="mt-2 flex items-end gap-2">
                <Textarea
                  rows={2}
                  value={comment}
                  placeholder="Write a comment… (Ctrl/⌘+Enter to post)"
                  onChange={(ev) => setComment(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && comment.trim()) {
                      ev.preventDefault()
                      post.mutate()
                    }
                  }}
                />
                <Button size="icon" disabled={!comment.trim()} isLoading={post.isPending} onClick={() => post.mutate()} aria-label="Post comment">
                  <Send size={16} />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      <ModalFooter>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
        {editable && (
          <Button
            size="sm"
            disabled={!dirty || (amountChanged && !reason.trim())}
            isLoading={save.isPending}
            onClick={() => save.mutate()}
          >
            Done
          </Button>
        )}
      </ModalFooter>
    </Modal>
  )
}
