import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsSection } from '@/components/shared/SettingsSection'
import { CADENCE_LABEL, CancelButton, Chip, Dialog, Empty, Field, ReadOnlyNote, fmtDate, fmtDateTime, money, newRequestId, num } from '@/components/invoices/shared'
import { apiError, subscriptionsApi } from '@/lib/api/invoicing'
import { usePermissions } from '@/lib/permissions'
import type { ClientSubscription, SubscriptionCharge } from '@/types/invoicing'
import { SUB_LABEL, SUB_TONE } from './ClientSubscriptions'

const chargeTone = (s: string) => (s === 'SUCCESS' ? 'green' : s === 'FAILED' ? 'red' : 'orange') as 'green' | 'red' | 'orange'

/** Settings §19: authorised auto-debits — charge now, cancel mandate, recent charges. */
export default function ClientMandates() {
  const qc = useQueryClient()
  const { canInvoice } = usePermissions()
  const [charging, setCharging] = useState<ClientSubscription | null>(null)
  const [cancelling, setCancelling] = useState<ClientSubscription | null>(null)
  const { data: mandates = [], isLoading } = useQuery({ queryKey: ['client-mandates'], queryFn: subscriptionsApi.mandates, enabled: canInvoice })
  const { data: charges = [] } = useQuery({ queryKey: ['client-charges'], queryFn: () => subscriptionsApi.charges(20), enabled: canInvoice })
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['client-mandates'] })
    qc.invalidateQueries({ queryKey: ['client-charges'] })
    qc.invalidateQueries({ queryKey: ['client-subscriptions'] })
  }
  const cancel = useMutation({
    mutationFn: (id: string) => subscriptionsApi.cancelMandate(id),
    onSuccess: () => (toast.success('Mandate cancelled'), setCancelling(null), invalidate()),
    onError: (e) => toast.error(apiError(e)),
  })

  return (
    <SettingsSection id="client-mandates" title="Client mandates" description="Authorised auto-debits from your clients.">
      {!canInvoice ? (
        <ReadOnlyNote>Read-only — Biller or Admin role required.</ReadOnlyNote>
      ) : isLoading ? (
        <p className="text-sm text-text-dim">Loading…</p>
      ) : (
        <div className="space-y-5">
          {mandates.length === 0 ? (
            <Empty>No authorised mandates yet. Send a client an authorisation link from Client subscriptions.</Empty>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border">
              {mandates.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{m.customer?.name}</span>
                      <Chip tone={SUB_TONE[m.status]}>{SUB_LABEL[m.status]}</Chip>
                      <Chip>{m.mandateType === 'CARD' ? `Card${m.cardLast4 ? ` •••• ${m.cardLast4}` : ''}` : 'Direct debit'}</Chip>
                    </div>
                    <div className="text-sm text-text-dim">
                      {m.planName} · <span className="tabular-nums">{money(m.amount)}</span> {CADENCE_LABEL[m.interval].toLowerCase()}
                      {m.status === 'ACTIVE' && ` · next ${fmtDate(m.nextRunAt)}`}
                      {m.lastChargedAt && ` · last charged ${fmtDate(m.lastChargedAt)}`}
                    </div>
                  </div>
                  {m.status === 'ACTIVE' && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setCharging(m)}>
                        <Zap size={14} /> Charge now
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setCancelling(m)}>
                        Cancel mandate
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">Recent charges</h3>
            {charges.length === 0 ? (
              <p className="text-sm text-text-dim">No charges yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {charges.map((c: SubscriptionCharge) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <span className="font-medium">{c.subscription?.customer.name}</span>
                      <span className="text-text-dim"> · {c.subscription?.planName}</span>
                      <div className="text-xs text-text-dim">
                        {fmtDateTime(c.attemptedAt)}
                        {c.failureReason && ` · ${c.failureReason}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums">{money(c.amount)}</span>
                      <Chip tone={chargeTone(c.status)}>{c.status}</Chip>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <ChargeDialog sub={charging} onClose={() => setCharging(null)} onDone={invalidate} />
      <Dialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        title="Cancel mandate?"
        footer={
          <>
            <CancelButton onClick={() => setCancelling(null)} />
            <Button size="sm" variant="destructive" isLoading={cancel.isPending} onClick={() => cancelling && cancel.mutate(cancelling.id)}>
              Cancel mandate
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-dim">{cancelling?.customer?.name} will no longer be debited. They would need to authorise again.</p>
      </Dialog>
    </SettingsSection>
  )
}

function ChargeDialog({ sub, onClose, onDone }: { sub: ClientSubscription | null; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [requestId, setRequestId] = useState(newRequestId)
  const charge = useMutation({
    mutationFn: () => subscriptionsApi.charge(sub!.id, { amount: amount ? Number(amount) : undefined, clientRequestId: requestId }),
    onSuccess: (c) => {
      if (c.status === 'SUCCESS') toast.success(`Charged ${money(c.amount)}`)
      else if (c.status === 'FAILED') toast.error(`Charge failed${c.failureReason ? `: ${c.failureReason}` : ''}`)
      else toast.success('Charge submitted; awaiting confirmation')
      setAmount('')
      setRequestId(newRequestId())
      onDone()
      onClose()
    },
    onError: (e) => toast.error(apiError(e)),
  })
  const amt = amount ? Number(amount) : num(sub?.amount)
  return (
    <Dialog
      open={!!sub}
      onClose={onClose}
      title={`Charge ${sub?.customer?.name ?? ''}`}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <Button size="sm" disabled={amt < 100} isLoading={charge.isPending} onClick={() => charge.mutate()}>
            Charge {money(amt)}
          </Button>
        </>
      }
    >
      <Field label="Amount (₦)" hint={`Defaults to the plan amount, ${money(sub?.amount)}`}>
        <Input type="number" min={100} value={amount} placeholder={String(num(sub?.amount))} onChange={(e) => setAmount(e.target.value)} />
      </Field>
    </Dialog>
  )
}
