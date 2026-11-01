import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Paperclip } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { DescriptionRulesHint } from '@/components/shared/DescriptionRulesHint'
import { formatDate } from '@/lib/utils'
import { formatNaira, toNumber } from '@/lib/money'
import { useAuthStore } from '@/stores/authStore'
import { requisitionKeys, requisitionsApi } from '@/lib/api/requisitions'
import { apiErrorMessage, apiErrors, queueApi } from '@/lib/api/queue'
import type { DescriptionIssue, RequisitionDetail } from '@/types/requisitions'
import { Chip, Field, ModalFooter } from '@/components/queue/common'
import { AiTidyInline, saveBlob } from '@/components/queue/helpers'
import { IssuesList, StatusBadge } from './shared'

const EDITABLE = ['DRAFT', 'SUBMITTED', 'RETURNED']

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{label}</div>
      <div className="text-sm">{children || <span className="text-text-muted">—</span>}</div>
    </div>
  )
}

export function RequisitionDetailModal({
  id,
  onClose,
  canProcure,
  canApprove,
  onPush,
}: {
  id: string | null
  onClose: () => void
  canProcure: boolean
  canApprove: boolean
  onPush: (r: RequisitionDetail) => void
}) {
  const qc = useQueryClient()
  const userId = useAuthStore((s) => s.user?.id)
  const { data: r, isLoading } = useQuery({ queryKey: requisitionKeys.detail(id ?? ''), queryFn: () => requisitionsApi.get(id!), enabled: !!id })
  const [desc, setDesc] = useState('')
  const [note, setNote] = useState('')
  const [wholeBundle, setWholeBundle] = useState(true)
  const [issues, setIssues] = useState<DescriptionIssue[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (r) {
      setDesc(r.description)
      setNote('')
      setIssues([])
    }
  }, [r])

  const isOwner = !!r && r.requestedById === userId
  const canEdit = !!r && EDITABLE.includes(r.status) && (isOwner || canProcure)
  const refresh = () => qc.invalidateQueries({ queryKey: requisitionKeys.all })

  const act = useMutation({
    mutationFn: async (action: 'save' | 'submit' | 'clear' | 'return' | 'reject' | 'undo' | 'delete') => {
      const body = { reviewNote: note.trim() || undefined, wholeBundle: !!r!.bundleId && wholeBundle }
      if (action === 'save') return requisitionsApi.update(r!.id, { description: desc.trim() })
      if (action === 'submit') {
        if (desc.trim() !== r!.description) await requisitionsApi.update(r!.id, { description: desc.trim() })
        return requisitionsApi.submit(r!.id, body)
      }
      if (action === 'clear') return requisitionsApi.clear(r!.id, body)
      if (action === 'return') return requisitionsApi.returnToRequester(r!.id, body)
      if (action === 'reject') return requisitionsApi.reject(r!.id, body)
      if (action === 'undo') return requisitionsApi.undo(r!.id, body)
      return requisitionsApi.remove(r!.id)
    },
    onSuccess: (_d, action) => {
      const msg = { save: 'Saved', submit: 'Submitted', clear: 'Cleared', return: 'Returned to requester', reject: 'Rejected', undo: 'Undone', delete: 'Deleted' }[action]
      toast.success(msg)
      refresh()
      if (action === 'delete' || action === 'clear' || action === 'reject' || action === 'return') onClose()
    },
    onError: (e) => {
      const srv = apiErrors<{ issues?: DescriptionIssue[] }>(e)?.issues
      if (srv?.length) setIssues(srv)
      toast.error(apiErrorMessage(e))
    },
  })

  const upload = useMutation({
    mutationFn: (f: File) => requisitionsApi.uploadAttachment(r!.id, f),
    onSuccess: () => {
      toast.success('File attached')
      qc.invalidateQueries({ queryKey: requisitionKeys.detail(r!.id) })
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })

  const needNote = (a: 'return' | 'reject') => {
    if (!note.trim()) {
      toast.error(`Add a note to ${a} this requisition`)
      return
    }
    act.mutate(a)
  }

  const s = r?.status
  const vendorName = r?.vendor?.name ?? r?.vendorName ?? ''
  const account = r?.isNewVendor
    ? [r.vendorBank, r.vendorAcctNo, r.vendorAcctName].filter(Boolean).join(' · ')
    : [r?.vendor?.bankName, r?.vendor?.bankAccountNumber, r?.vendor?.verifiedAccountName ?? r?.vendor?.accountName].filter(Boolean).join(' · ')

  return (
    <Modal isOpen={!!id} onClose={onClose} title={r?.reqRef ? `Requisition ${r.reqRef}` : 'Requisition'} className="max-w-2xl">
      {isLoading || !r ? (
        <div className="py-10 text-center text-sm text-text-dim">Loading…</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status} />
            <span className="text-xs text-text-dim">{formatDate(r.date)}</span>
            {r.bundleLabel && <Chip tone="gold">{r.bundleLabel}</Chip>}
            {r.isNewVendor && <Chip tone="blue">New vendor</Chip>}
          </div>

          <Field label="Description" hint={canEdit && <AiTidyInline description={desc} vendorName={vendorName} onChange={setDesc} />}>
            <Textarea rows={2} value={desc} disabled={!canEdit} onChange={(e) => setDesc(e.target.value)} />
            {canEdit && <DescriptionRulesHint description={desc} vendorName={vendorName} showOk={false} />}
          </Field>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Row label="Department">{r.department?.name ?? r.departmentName}</Row>
            <Row label="Requester">{r.requesterName ?? r.requestedBy?.displayName}</Row>
            <Row label="Vendor">{vendorName}</Row>
            <Row label="Account">{account}</Row>
            <Row label="Category / COA">{[r.payCategory?.name, r.coaTag?.name].filter(Boolean).join(' · ')}</Row>
            <Row label="BU / Head">{[r.costCenter?.name, r.location?.isGeneral ? 'General' : r.location?.name].filter(Boolean).join(' · ')}</Row>
            <Row label="Quantity">
              {toNumber(r.units)} {r.unitName ?? ''}
            </Row>
            <Row label="Unit amount">{formatNaira(r.unitAmount)}</Row>
            <Row label="Total">
              <span className="font-bold tabular-nums">{formatNaira(r.total)}</span>
            </Row>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Row label="Reason">{r.reason}</Row>
            <Row label="Remarks">{r.remarks}</Row>
          </div>
          {(r.reviewNote || r.rejectionReason) && (
            <div className="rounded-xl border border-border bg-surface2/60 p-3 text-sm">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Review note</div>
              {r.reviewNote ?? r.rejectionReason}
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Attachments</div>
              {(isOwner || canProcure) && s !== 'QUEUED' && (
                <>
                  <button className="inline-flex items-center gap-1 text-[11px] font-semibold text-gold" onClick={() => fileRef.current?.click()}>
                    <Paperclip size={12} /> {upload.isPending ? 'Uploading…' : 'Add file'}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) upload.mutate(f)
                    }}
                  />
                </>
              )}
            </div>
            {r.attachments.length === 0 ? (
              <div className="text-xs text-text-muted">No files.</div>
            ) : (
              r.attachments.map((a) => (
                <button
                  key={a.id}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-surface2"
                  onClick={async () => {
                    try {
                      saveBlob(await queueApi.downloadAttachment(a.id), a.fileName)
                    } catch (e) {
                      toast.error(apiErrorMessage(e))
                    }
                  }}
                >
                  <Download size={13} className="text-text-dim" /> {a.fileName}
                </button>
              ))
            )}
          </div>

          {s !== 'QUEUED' && (
            <Field label="Note to requester / procurement" hint="Required to return or reject.">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          )}
          {r.bundleId && s !== 'QUEUED' && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-text-dim">
              <input type="checkbox" className="accent-[var(--gold)]" checked={wholeBundle} onChange={(e) => setWholeBundle(e.target.checked)} />
              Apply to every item in “{r.bundleLabel}”
            </label>
          )}
          <IssuesList issues={issues} />
        </div>
      )}
      {r && (
        <ModalFooter>
          {canEdit && (isOwner || canProcure) && (
            <Button variant="ghost" size="sm" className="mr-auto text-red" disabled={act.isPending} onClick={() => window.confirm('Delete this requisition?') && act.mutate('delete')}>
              Delete
            </Button>
          )}
          {s === 'SUBMITTED' && (isOwner || canProcure) && (
            <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate('undo')}>
              Undo submit
            </Button>
          )}
          {canProcure && (s === 'PROCUREMENT_CLEARED' || s === 'RETURNED' || s === 'REJECTED') && (
            <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate('undo')}>
              Undo
            </Button>
          )}
          {canEdit && desc.trim() !== r.description && s !== 'DRAFT' && s !== 'RETURNED' && (
            <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate('save')}>
              Save description
            </Button>
          )}
          {(s === 'DRAFT' || s === 'RETURNED') && (isOwner || canProcure) && (
            <>
              {desc.trim() !== r.description && (
                <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate('save')}>
                  Save draft
                </Button>
              )}
              <Button size="sm" isLoading={act.isPending && act.variables === 'submit'} onClick={() => act.mutate('submit')}>
                Submit
              </Button>
            </>
          )}
          {canProcure && (s === 'SUBMITTED' || s === 'PROCUREMENT_CLEARED' || s === 'RETURNED') && (
            <Button variant="outline" size="sm" className="text-red" disabled={act.isPending} onClick={() => needNote('reject')}>
              Reject
            </Button>
          )}
          {canProcure && (s === 'SUBMITTED' || s === 'PROCUREMENT_CLEARED') && (
            <Button variant="outline" size="sm" className="text-orange" disabled={act.isPending} onClick={() => needNote('return')}>
              Return
            </Button>
          )}
          {canProcure && s === 'SUBMITTED' && (
            <Button size="sm" className="bg-green text-white" isLoading={act.isPending && act.variables === 'clear'} onClick={() => act.mutate('clear')}>
              Clear
            </Button>
          )}
          {canApprove && s === 'PROCUREMENT_CLEARED' && (
            <Button size="sm" onClick={() => onPush(r)}>
              Push to queue
            </Button>
          )}
        </ModalFooter>
      )}
    </Modal>
  )
}
