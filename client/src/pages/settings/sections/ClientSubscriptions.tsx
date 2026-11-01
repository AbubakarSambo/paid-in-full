import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link2, MessageCircle, Plus, Trash2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SettingsSection } from '@/components/shared/SettingsSection'
import {
  CADENCE_LABEL,
  CancelButton,
  Chip,
  CopyButton,
  Dialog,
  Empty,
  Field,
  ReadOnlyNote,
  copyText,
  fmtDate,
  isoDay,
  money,
} from '@/components/invoices/shared'
import { apiError, invCustomersApi, subscriptionsApi } from '@/lib/api/invoicing'
import { usePermissions } from '@/lib/permissions'
import type { ClientSubscription, RecurrenceInterval, SubscriptionStatus } from '@/types/invoicing'

export const SUB_TONE: Record<SubscriptionStatus, 'orange' | 'green' | 'dim'> = { PENDING_MANDATE: 'orange', ACTIVE: 'green', CANCELLED: 'dim' }
export const SUB_LABEL: Record<SubscriptionStatus, string> = { PENDING_MANDATE: 'Awaiting mandate', ACTIVE: 'Active', CANCELLED: 'Cancelled' }

/** Settings §18: plans you charge your own clients, with an authorisation link (/m/:token). */
export default function ClientSubscriptions() {
  const qc = useQueryClient()
  const { canInvoice } = usePermissions()
  const [creating, setCreating] = useState(false)
  const [link, setLink] = useState<{ sub: ClientSubscription; url: string; waLink: string } | null>(null)
  const [cancelling, setCancelling] = useState<ClientSubscription | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['client-subscriptions'],
    queryFn: () => subscriptionsApi.list({ limit: 100 }),
    enabled: canInvoice,
  })
  const rows = data?.data ?? []
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['client-subscriptions'] })
    qc.invalidateQueries({ queryKey: ['client-mandates'] })
  }

  const genLink = useMutation({
    mutationFn: ({ sub, regenerate }: { sub: ClientSubscription; regenerate?: boolean }) =>
      subscriptionsApi.authorisationLink(sub.id, regenerate).then((r) => ({ sub, ...r })),
    onSuccess: (r) => {
      setLink(r)
      invalidate()
    },
    onError: (e) => toast.error(apiError(e)),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => subscriptionsApi.cancel(id),
    onSuccess: () => {
      toast.success('Subscription cancelled')
      setCancelling(null)
      invalidate()
    },
    onError: (e) => toast.error(apiError(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => subscriptionsApi.remove(id),
    onSuccess: () => (toast.success('Plan deleted'), invalidate()),
    onError: (e) => toast.error(apiError(e)),
  })

  return (
    <SettingsSection
      id="client-subscriptions"
      title="Client subscriptions"
      description="Recurring plans you charge your own clients by card or direct debit."
      actions={
        canInvoice && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> New plan
          </Button>
        )
      }
    >
      {!canInvoice ? (
        <ReadOnlyNote>Read-only — Biller or Admin role required.</ReadOnlyNote>
      ) : isLoading ? (
        <p className="text-sm text-text-dim">Loading…</p>
      ) : rows.length === 0 ? (
        <Empty>No client plans yet.</Empty>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {rows.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{s.customer?.name}</span>
                  <Chip tone={SUB_TONE[s.status]}>{SUB_LABEL[s.status]}</Chip>
                  {s.mandateType && <Chip>{s.mandateType === 'CARD' ? `Card ${s.cardLast4 ? `•••• ${s.cardLast4}` : ''}` : 'Direct debit'}</Chip>}
                </div>
                <div className="text-sm text-text-dim">
                  {s.planName} · <span className="tabular-nums">{money(s.amount)}</span> {CADENCE_LABEL[s.interval].toLowerCase()}
                  {s.status !== 'CANCELLED' && ` · next ${fmtDate(s.nextRunAt)}`}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {s.status === 'PENDING_MANDATE' && (
                  <Button size="sm" variant="outline" isLoading={genLink.isPending && genLink.variables?.sub.id === s.id} onClick={() => genLink.mutate({ sub: s })}>
                    <Link2 size={14} /> Authorisation link
                  </Button>
                )}
                {s.status !== 'CANCELLED' && (
                  <Button size="sm" variant="outline" onClick={() => setCancelling(s)}>
                    <XCircle size={14} /> Cancel
                  </Button>
                )}
                {s.status !== 'ACTIVE' && !s.lastChargedAt && (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(s.id)} aria-label="Delete plan">
                    <Trash2 size={14} />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreatePlanDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(sub) => {
          invalidate()
          genLink.mutate({ sub })
        }}
      />

      <Dialog
        open={!!link}
        onClose={() => setLink(null)}
        title="Authorisation link"
        description={`Send this to ${link?.sub.customer?.name ?? 'your client'} to set up the auto-debit.`}
        footer={
          <>
            <Button size="sm" variant="outline" onClick={() => link && genLink.mutate({ sub: link.sub, regenerate: true })}>
              Regenerate
            </Button>
            <Button size="sm" variant="outline" onClick={() => link && window.open(link.waLink, '_blank', 'noopener')}>
              <MessageCircle size={14} /> WhatsApp
            </Button>
            <Button size="sm" onClick={() => link && copyText(link.url, 'Link copied')}>
              Copy link
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface2 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 break-all">{link?.url}</span>
          {link && <CopyButton text={link.url} label="Link copied" />}
        </div>
      </Dialog>

      <Dialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        title="Cancel this plan?"
        footer={
          <>
            <CancelButton onClick={() => setCancelling(null)} />
            <Button size="sm" variant="destructive" isLoading={cancel.isPending} onClick={() => cancelling && cancel.mutate(cancelling.id)}>
              Cancel plan
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-dim">
          {cancelling?.customer?.name} will not be charged again
          {cancelling?.status === 'ACTIVE' ? ' and the mandate is revoked' : ''}.
        </p>
      </Dialog>
    </SettingsSection>
  )
}

function CreatePlanDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (s: ClientSubscription) => void }) {
  const [f, setF] = useState({ customerId: '', planName: '', amount: '', interval: 'MONTHLY' as RecurrenceInterval, description: '', startDate: isoDay() })
  const { data } = useQuery({
    queryKey: ['inv-customers', 'picker'],
    queryFn: () => invCustomersApi.list({ status: 'active', limit: 100 }),
    enabled: open,
  })
  const create = useMutation({
    mutationFn: () =>
      subscriptionsApi.create({
        customerId: f.customerId,
        planName: f.planName.trim(),
        amount: Number(f.amount),
        interval: f.interval,
        description: f.description.trim() || undefined,
        startDate: f.startDate || undefined,
      }),
    onSuccess: (s) => {
      toast.success('Plan created')
      setF({ customerId: '', planName: '', amount: '', interval: 'MONTHLY', description: '', startDate: isoDay() })
      onClose()
      onCreated(s)
    },
    onError: (e) => toast.error(apiError(e)),
  })
  const amt = Number(f.amount)
  const valid = !!f.customerId && !!f.planName.trim() && amt >= 100
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New client plan"
      footer={
        <>
          <CancelButton onClick={onClose} />
          <Button size="sm" disabled={!valid} isLoading={create.isPending} onClick={() => create.mutate()}>
            Create &amp; get link
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client" className="sm:col-span-2">
          <Select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}>
            <option value="">Select a customer…</option>
            {(data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Plan name" className="sm:col-span-2">
          <Input value={f.planName} onChange={(e) => setF({ ...f, planName: e.target.value })} placeholder="Monthly retainer" />
        </Field>
        <Field label="Amount (₦)">
          <Input
            type="number"
            min={100}
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
            error={f.amount !== '' && amt < 100 ? 'Minimum ₦100' : undefined}
          />
        </Field>
        <Field label="Frequency">
          <Select value={f.interval} onChange={(e) => setF({ ...f, interval: e.target.value as RecurrenceInterval })}>
            {(Object.keys(CADENCE_LABEL) as RecurrenceInterval[]).map((k) => (
              <option key={k} value={k}>
                {CADENCE_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="First charge">
          <Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  )
}
