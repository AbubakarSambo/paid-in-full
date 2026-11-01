import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Ban,
  Copy,
  CopyPlus,
  CreditCard,
  Download,
  FileText,
  Link2,
  Mail,
  MessageCircle,
  Pencil,
  Repeat,
  Send,
  Trash2,
  Wallet,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { downloadBlob } from '@/lib/utils'
import { apiError, apiStatus, invCustomersApi, invoicesApi } from '@/lib/api/invoicing'
import type { Invoice, RecordPaymentInput, RecurrenceInterval } from '@/types/invoicing'
import {
  CADENCE_LABEL,
  CancelButton,
  Chip,
  CopyButton,
  Dialog,
  Field,
  Segmented,
  StatusChip,
  copyText,
  fmtDate,
  fmtDateTime,
  isoDay,
  money,
  newRequestId,
  num,
  optStr,
} from './shared'

type Sub = null | 'send' | 'payment' | 'credit' | 'template' | 'recurrence' | 'delete' | 'void' | 'simulate'

export function InvoiceDetail({
  invoiceId,
  onClose,
  onEdit,
  onOpenInvoice,
}: {
  invoiceId: string | null
  onClose: () => void
  onEdit: (inv: Invoice) => void
  onOpenInvoice: (id: string) => void
}) {
  const qc = useQueryClient()
  const [sub, setSub] = useState<Sub>(null)
  const { data: inv, isLoading } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => invoicesApi.get(invoiceId!),
    enabled: !!invoiceId,
  })

  const refresh = (next?: Invoice) => {
    if (next) qc.setQueryData(['invoice', next.id], next)
    else qc.invalidateQueries({ queryKey: ['invoice', invoiceId] })
    qc.invalidateQueries({ queryKey: ['invoices'] })
    qc.invalidateQueries({ queryKey: ['invoice-summary'] })
  }
  const act = useMutation({
    mutationFn: async (fn: () => Promise<Invoice | void>) => fn(),
    onSuccess: (res) => refresh(res || undefined),
    onError: (e) => toast.error(apiError(e)),
  })

  if (!invoiceId) return null
  const isQuote = inv?.docType === 'QUOTE'
  const label = isQuote ? 'Quote' : 'Invoice'
  const isDraft = inv?.status === 'DRAFT'
  const isVoid = inv?.status === 'VOID'
  const cur = inv?.currency ?? 'NGN'
  const isMockAccount = !!inv?.collectionBankName?.toLowerCase().includes('mock')

  const run = (fn: () => Promise<Invoice | void>, msg: string) =>
    act.mutate(fn, { onSuccess: () => toast.success(msg) })

  const downloadPdf = async () => {
    if (!inv) return
    try {
      downloadBlob(await invoicesApi.pdf(inv.id), `${inv.number ?? 'invoice'}.pdf`)
    } catch (e) {
      toast.error(apiError(e, 'Could not download PDF'))
    }
  }
  const copyLink = async () => {
    if (!inv) return
    try {
      const { url } = await invoicesApi.shareLink(inv.id)
      await copyText(url, 'Public link copied')
      refresh()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  return (
    <>
      <Dialog
        open={!!invoiceId}
        onClose={onClose}
        size="xl"
        title={inv ? `${label} ${inv.number ?? ''}` : 'Loading…'}
        description={inv?.customer?.name}
      >
        {isLoading || !inv ? (
          <div className="py-12 text-center text-sm text-text-dim">Loading…</div>
        ) : (
          <div className="space-y-6">
            {/* Header row */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <StatusChip status={inv.status} quote={isQuote} expired={inv.isQuoteExpired} />
                <div className="text-sm text-text-dim">
                  Issued {fmtDate(inv.issueDate)} · {isQuote ? `Expires ${fmtDate(inv.quoteExpiresAt)}` : `Due ${fmtDate(inv.dueDate)}`}
                  {inv.sentAt && ` · Sent ${fmtDateTime(inv.sentAt)}`}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-dim">Balance</div>
                <div className="text-3xl font-bold tabular-nums text-gold">{money(inv.balance, cur)}</div>
                <div className="text-xs text-text-dim tabular-nums">
                  of {money(inv.amountDue, cur)} · paid {money(inv.paidAmount, cur)}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {isDraft && (
                <>
                  <Button size="sm" variant="outline" onClick={() => onEdit(inv)}>
                    <Pencil size={14} /> Edit
                  </Button>
                  <Button size="sm" isLoading={act.isPending} onClick={() => run(() => invoicesApi.issue(inv.id), `${label} issued`)}>
                    Issue
                  </Button>
                </>
              )}
              {!isVoid && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setSub('send')}>
                    <Send size={14} /> Send
                  </Button>
                  {!inv.sentAt && (
                    <Button size="sm" variant="outline" onClick={() => run(() => invoicesApi.markSent(inv.id), 'Marked as sent')}>
                      <Mail size={14} /> Mark sent
                    </Button>
                  )}
                </>
              )}
              {!isDraft && (
                <Button size="sm" variant="outline" onClick={copyLink}>
                  <Link2 size={14} /> Copy public link
                </Button>
              )}
              {!isQuote && !isDraft && !isVoid && inv.balance > 0 && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setSub('payment')}>
                    <Wallet size={14} /> Record payment
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setSub('credit')}>
                    <CreditCard size={14} /> Apply credit
                  </Button>
                </>
              )}
              {isQuote && !isVoid && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => run(() => invoicesApi.convert(inv.id), 'Converted to an invoice (new number allocated)')}
                >
                  <FileText size={14} /> Convert to invoice
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  act.mutate(() => invoicesApi.duplicate(inv.id), {
                    onSuccess: (d) => {
                      toast.success(`Duplicated as ${d?.number ?? 'a new draft'}`)
                      if (d) onOpenInvoice(d.id)
                    },
                  })
                }
              >
                <CopyPlus size={14} /> Duplicate
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSub('template')}>
                <Copy size={14} /> Save as template
              </Button>
              {!isQuote && !inv.sourceOfRecurrence && (
                <Button size="sm" variant="outline" onClick={() => setSub('recurrence')}>
                  <Repeat size={14} /> Make recurring
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={downloadPdf}>
                <Download size={14} /> PDF
              </Button>
              {!isVoid && inv.status !== 'PAID' && (
                <Button size="sm" variant="outline" onClick={() => setSub('void')}>
                  <Ban size={14} /> Void
                </Button>
              )}
              <Button size="sm" variant="outline" className="hover:text-red" onClick={() => setSub('delete')}>
                <Trash2 size={14} /> Delete
              </Button>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
              <div className="space-y-6 min-w-0">
                {/* Items */}
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-surface2 text-[10px] uppercase tracking-wider text-text-dim">
                      <tr>
                        <th className="px-3 py-2 text-left">Description</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Unit</th>
                        <th className="px-3 py-2 text-right">VAT</th>
                        <th className="px-3 py-2 text-right">WHT</th>
                        <th className="px-3 py-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(inv.items ?? []).map((it) => (
                        <tr key={it.id} className="border-t border-border">
                          <td className="px-3 py-2">{it.description}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{num(it.quantity)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(it.unitPrice, cur)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{num(it.vatRate)}%</td>
                          <td className="px-3 py-2 text-right tabular-nums">{num(it.whtRate)}%</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(it.lineTotal, cur)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Payments */}
                <Section title="Payments">
                  {(inv.payments ?? []).length === 0 ? (
                    <p className="text-sm text-text-dim">No payments yet.</p>
                  ) : (
                    <ul className="divide-y divide-border text-sm">
                      {inv.payments!.map((p) => {
                        const receipt = inv.receipts?.find((r) => r.invoicePaymentId === p.id)
                        return (
                          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                            <div>
                              <span className="font-semibold tabular-nums">{money(p.amount, cur)}</span>{' '}
                              <Chip>{p.method ?? 'TRANSFER'}</Chip>
                              <div className="text-xs text-text-dim">
                                {fmtDateTime(p.paidAt)}
                                {p.monnifyReference && ` · ${p.monnifyReference}`}
                                {p.notes && ` · ${p.notes}`}
                              </div>
                            </div>
                            {receipt && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  try {
                                    downloadBlob(await invoicesApi.receiptPdf(inv.id, receipt.id), `${receipt.receiptNumber}.pdf`)
                                  } catch (e) {
                                    toast.error(apiError(e))
                                  }
                                }}
                              >
                                <Download size={14} /> {receipt.receiptNumber}
                              </Button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {(inv.creditsCreated ?? []).length > 0 && (
                    <p className="mt-2 text-xs text-green">
                      Overpayment moved to customer credit: {money(inv.creditsCreated!.reduce((s, c) => s + num(c.amount), 0), cur)}
                    </p>
                  )}
                  {(inv.sweeps ?? []).length > 0 && (
                    <div className="mt-3 space-y-1 text-xs text-text-dim">
                      {inv.sweeps!.map((s) => (
                        <div key={s.id}>
                          Auto-swept {money(s.amount, cur)} · {s.status ?? 'PENDING'} · {fmtDateTime(s.matchedAt)}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                {/* Send history */}
                <Section title="Send history">
                  {(inv.sends ?? []).length === 0 ? (
                    <p className="text-sm text-text-dim">Not sent yet.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {inv.sends!.map((s) => (
                        <li key={s.id} className="flex flex-wrap gap-2">
                          <Chip tone={s.channel === 'WHATSAPP' ? 'green' : 'blue'}>{s.channel}</Chip>
                          <span>{s.sentTo}</span>
                          {s.cc && <span className="text-text-dim">cc {s.cc}</span>}
                          <span className="text-text-dim">{fmtDateTime(s.sentAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>

                {(inv.notes || inv.terms) && (
                  <Section title="Notes & terms">
                    {inv.notes && <p className="whitespace-pre-wrap text-sm">{inv.notes}</p>}
                    {inv.terms && <p className="mt-2 whitespace-pre-wrap text-xs text-text-dim">{inv.terms}</p>}
                  </Section>
                )}
              </div>

              <aside className="space-y-4">
                <div className="rounded-xl border border-border bg-surface2/50 p-4 text-sm">
                  <TotRow l="Subtotal" v={money(inv.subtotal, cur)} />
                  {num(inv.discountAmount) > 0 && <TotRow l="Discount" v={`− ${money(inv.discountAmount, cur)}`} />}
                  <TotRow l="VAT" v={money(inv.vatTotal, cur)} />
                  <TotRow l="Total" v={money(inv.total, cur)} strong />
                  {num(inv.whtTotal) > 0 && <TotRow l="Less WHT" v={`− ${money(inv.whtTotal, cur)}`} />}
                  {num(inv.lateFeeAmount) > 0 && <TotRow l="Late fee" v={money(inv.lateFeeAmount, cur)} />}
                  {num(inv.earlyPayDiscountAmount) > 0 && <TotRow l="Early-pay discount" v={`− ${money(inv.earlyPayDiscountAmount, cur)}`} />}
                  <TotRow l="Amount due" v={money(inv.amountDue, cur)} strong />
                  <TotRow l="Paid" v={money(inv.paidAmount, cur)} />
                  <TotRow l="Balance" v={money(inv.balance, cur)} strong />
                </div>

                {!isQuote && !isDraft && (
                  <div className="rounded-xl border border-border p-4 text-sm">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-dim">Collection account</div>
                    {inv.collectionAccountNumber ? (
                      <>
                        <div className="flex items-center gap-1 text-lg font-bold tabular-nums">
                          {inv.collectionAccountNumber}
                          <CopyButton text={inv.collectionAccountNumber} label="Account number copied" />
                        </div>
                        <div className="text-text-dim">{inv.collectionBankName}</div>
                        <div className="text-text-dim">{inv.collectionAccountName}</div>
                        <p className="mt-2 text-xs text-text-muted">Transfers here are matched to this invoice automatically.</p>
                        {isMockAccount && !isVoid && inv.balance > 0 && (
                          <Button size="sm" variant="outline" className="mt-3" onClick={() => setSub('simulate')}>
                            <Zap size={14} /> Simulate payment (mock)
                          </Button>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-text-dim">No dedicated account yet.</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          isLoading={act.isPending}
                          onClick={() => run(() => invoicesApi.ensureCollectionAccount(inv.id), 'Collection account created')}
                        >
                          Create collection account
                        </Button>
                      </>
                    )}
                  </div>
                )}

                <div className="rounded-xl border border-border p-4 text-xs text-text-dim space-y-1">
                  {inv.customerAddress && <div className="whitespace-pre-wrap">{inv.customerAddress}</div>}
                  {inv.customerTin && <div>Customer TIN: {inv.customerTin}</div>}
                  {inv.workspaceTin && <div>Our TIN: {inv.workspaceTin}</div>}
                  {inv.taxInclusive && <div>Prices include VAT</div>}
                  {inv.currency !== 'NGN' && inv.fxRate && (
                    <div>
                      FX: 1 {inv.currency} = {num(inv.fxRate)} {inv.fxBaseCurrency}
                    </div>
                  )}
                  {(inv.lateFeePercent || inv.lateFeeFlat) && (
                    <div>
                      Late fee: {inv.lateFeePercent ? `${num(inv.lateFeePercent)}%` : ''} {inv.lateFeeFlat ? money(inv.lateFeeFlat, cur) : ''} after{' '}
                      {inv.lateFeeGraceDays ?? 0} grace days
                    </div>
                  )}
                  {inv.earlyPayDiscountPercent && (
                    <div>
                      Early pay: {num(inv.earlyPayDiscountPercent)}% within {inv.earlyPayDiscountDays} days
                    </div>
                  )}
                  {inv.shareUrl && (
                    <div className="flex items-center gap-1 break-all">
                      {inv.shareUrl} <CopyButton text={inv.shareUrl} />
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </div>
        )}
      </Dialog>

      {inv && (
        <>
          <SendDialog open={sub === 'send'} onClose={() => setSub(null)} inv={inv} onDone={() => refresh()} />
          <PaymentDialog open={sub === 'payment'} onClose={() => setSub(null)} inv={inv} onDone={() => refresh()} />
          <ApplyCreditDialog open={sub === 'credit'} onClose={() => setSub(null)} inv={inv} onDone={() => refresh()} />
          <TemplateDialog open={sub === 'template'} onClose={() => setSub(null)} inv={inv} />
          <RecurrenceDialog open={sub === 'recurrence'} onClose={() => setSub(null)} inv={inv} onDone={() => refresh()} />
          <SimulateDialog open={sub === 'simulate'} onClose={() => setSub(null)} inv={inv} onDone={() => refresh()} />
          <VoidDialog
            open={sub === 'void'}
            onClose={() => setSub(null)}
            inv={inv}
            onConfirm={() => act.mutate(() => invoicesApi.void(inv.id), { onSuccess: () => (toast.success(`${label} voided`), setSub(null)) })}
            loading={act.isPending}
          />
          <DeleteDialog
            open={sub === 'delete'}
            onClose={() => setSub(null)}
            inv={inv}
            onDeleted={() => {
              setSub(null)
              qc.invalidateQueries({ queryKey: ['invoices'] })
              qc.invalidateQueries({ queryKey: ['invoice-summary'] })
              onClose()
            }}
          />
        </>
      )}
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">{title}</h4>
      {children}
    </div>
  )
}
function TotRow({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${strong ? 'font-bold' : ''}`}>
      <span className={strong ? '' : 'text-text-dim'}>{l}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  )
}

// ─── Sub-dialogs ───────────────────────────────────────────────────────────

interface SubProps {
  open: boolean
  onClose: () => void
  inv: Invoice
  onDone?: () => void
}

function SendDialog({ open, onClose, inv, onDone }: SubProps) {
  const [channel, setChannel] = useState<'EMAIL' | 'WHATSAPP'>('EMAIL')
  const [recipient, setRecipient] = useState('')
  const [cc, setCc] = useState('')
  const [message, setMessage] = useState('')
  const ccList = cc
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  const ccBad = ccList.some((x) => !/^\S+@\S+\.\S+$/.test(x))
  const send = useMutation({
    mutationFn: () =>
      invoicesApi.send(inv.id, {
        channel,
        recipient: optStr(recipient),
        ...(channel === 'EMAIL' ? { cc: ccList } : { message: optStr(message) }),
      }),
    onSuccess: (res) => {
      if (res.channel === 'WHATSAPP' && res.waLink) {
        window.open(res.waLink, '_blank', 'noopener')
        toast.success('WhatsApp opened with the invoice link')
      } else {
        toast.success('Invoice emailed')
        if (res.ccFailures?.length) toast.warning(`CC failed: ${res.ccFailures.join(', ')}`)
      }
      onDone?.()
      onClose()
    },
    onError: (e) => toast.error(apiError(e, 'Could not send')),
  })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Send ${inv.number ?? ''}`}
      description={inv.status === 'DRAFT' ? 'Sending a draft issues it first.' : undefined}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <Button size="sm" isLoading={send.isPending} disabled={channel === 'EMAIL' && ccBad} onClick={() => send.mutate()}>
            {channel === 'EMAIL' ? <Mail size={14} /> : <MessageCircle size={14} />} Send
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Segmented
          value={channel}
          onChange={setChannel}
          options={[
            { value: 'EMAIL', label: 'Email' },
            { value: 'WHATSAPP', label: 'WhatsApp' },
          ]}
        />
        <Field
          label={channel === 'EMAIL' ? 'To' : 'Phone'}
          hint={`Defaults to the customer's ${channel === 'EMAIL' ? 'email' : 'phone'}${
            channel === 'EMAIL' ? (inv.customer?.email ? ` (${inv.customer.email})` : '') : inv.customer?.phone ? ` (${inv.customer.phone})` : ''
          }`}
        >
          <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} />
        </Field>
        {channel === 'EMAIL' ? (
          <Field label="CC" hint="Separate addresses with commas">
            <Input value={cc} onChange={(e) => setCc(e.target.value)} error={ccBad ? 'One of the CC addresses is invalid' : undefined} />
          </Field>
        ) : (
          <Field label="Message (optional)" hint="The public link is appended">
            <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
        )}
      </div>
    </Dialog>
  )
}

function PaymentDialog({ open, onClose, inv, onDone }: SubProps) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(isoDay())
  const [method, setMethod] = useState<NonNullable<RecordPaymentInput['method']>>('TRANSFER')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [requestId, setRequestId] = useState(newRequestId)
  const amt = Number(amount)
  const over = amt > inv.balance ? amt - inv.balance : 0
  const pay = useMutation({
    mutationFn: () =>
      invoicesApi.recordPayment(inv.id, {
        amount: amt,
        paymentDate: date,
        method,
        reference: optStr(reference),
        notes: optStr(notes),
        clientRequestId: requestId,
      }),
    onSuccess: (res) => {
      toast.success(`Payment of ${money(res.applied, inv.currency)} recorded`)
      if (res.credit) toast.success(`${money(res.credit.amount, inv.currency)} became customer credit`)
      setAmount('')
      setReference('')
      setNotes('')
      setRequestId(newRequestId())
      onDone?.()
      onClose()
    },
    onError: (e) => toast.error(apiError(e, 'Could not record payment')),
  })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record payment"
      description={`Balance ${money(inv.balance, inv.currency)}`}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <Button size="sm" isLoading={pay.isPending} disabled={!(amt > 0)} onClick={() => pay.mutate()}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount">
          <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {(['TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'POS', 'OTHER'] as const).map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reference">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="sm:col-span-2 flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setAmount(String(inv.balance))}>
            Pay full balance
          </Button>
        </div>
        {over > 0 && (
          <p className="sm:col-span-2 rounded-lg bg-green/10 px-3 py-2 text-sm text-green">
            {money(over, inv.currency)} over the balance will become customer credit.
          </p>
        )}
      </div>
    </Dialog>
  )
}

function ApplyCreditDialog({ open, onClose, inv, onDone }: SubProps) {
  const { data: credits = [], isLoading } = useQuery({
    queryKey: ['inv-customer-credits', inv.customerId],
    queryFn: () => invCustomersApi.credits(inv.customerId),
    enabled: open,
  })
  const qc = useQueryClient()
  const open_ = credits.filter((c) => c.status === 'OPEN')
  const apply = useMutation({
    mutationFn: (creditId: string) => invoicesApi.applyCredit(inv.id, creditId),
    onSuccess: (res) => {
      toast.success(`Applied ${money(res.appliedCreditAmount, inv.currency)} of credit`)
      qc.invalidateQueries({ queryKey: ['inv-customer-credits'] })
      qc.invalidateQueries({ queryKey: ['credits'] })
      onDone?.()
      onClose()
    },
    onError: (e) => toast.error(apiError(e)),
  })
  return (
    <Dialog open={open} onClose={onClose} title="Apply customer credit" description={`Balance ${money(inv.balance, inv.currency)}`}>
      {isLoading ? (
        <p className="text-sm text-text-dim">Loading…</p>
      ) : open_.length === 0 ? (
        <p className="text-sm text-text-dim">{inv.customer?.name ?? 'This customer'} has no open credit.</p>
      ) : (
        <ul className="divide-y divide-border">
          {open_.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <div className="font-semibold tabular-nums">{money(c.amount, inv.currency)}</div>
                <div className="text-xs text-text-dim">
                  {c.note ?? 'Credit'} · {fmtDate(c.createdAt)}
                </div>
              </div>
              <Button size="sm" isLoading={apply.isPending && apply.variables === c.id} onClick={() => apply.mutate(c.id)}>
                Apply
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

function TemplateDialog({ open, onClose, inv }: SubProps) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const save = useMutation({
    mutationFn: () => invoicesApi.saveAsTemplate(inv.id, name.trim()),
    onSuccess: () => {
      toast.success('Template saved')
      qc.invalidateQueries({ queryKey: ['invoice-templates'] })
      setName('')
      onClose()
    },
    onError: (e) => toast.error(apiError(e)),
  })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Save as template"
      footer={
        <>
          <CancelButton onClick={onClose} />
          <Button size="sm" disabled={!name.trim()} isLoading={save.isPending} onClick={() => save.mutate()}>
            Save template
          </Button>
        </>
      }
    >
      <Field label="Template name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly retainer" autoFocus />
      </Field>
    </Dialog>
  )
}

export function RecurrenceDialog({ open, onClose, inv, onDone }: SubProps) {
  const qc = useQueryClient()
  const [interval, setInterval] = useState<RecurrenceInterval>('MONTHLY')
  const [nextRunAt, setNextRunAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [dueDays, setDueDays] = useState(String(inv.dueDays ?? 14))
  const save = useMutation({
    mutationFn: () =>
      invoicesApi.createRecurrence(inv.id, {
        interval,
        nextRunAt: nextRunAt || undefined,
        endsAt: endsAt || undefined,
        dueDays: Number(dueDays) || 14,
      }),
    onSuccess: (r) => {
      toast.success(`Recurring ${CADENCE_LABEL[r.interval].toLowerCase()} · next run ${fmtDate(r.nextRunAt)}`)
      qc.invalidateQueries({ queryKey: ['invoice-recurrences'] })
      onDone?.()
      onClose()
    },
    onError: (e) => toast.error(apiError(e)),
  })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Make recurring"
      description="Copies these lines into a schedule that generates drafts for review."
      footer={
        <>
          <CancelButton onClick={onClose} />
          <Button size="sm" isLoading={save.isPending} onClick={() => save.mutate()}>
            Create schedule
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cadence">
          <Select value={interval} onChange={(e) => setInterval(e.target.value as RecurrenceInterval)}>
            {(Object.keys(CADENCE_LABEL) as RecurrenceInterval[]).map((k) => (
              <option key={k} value={k}>
                {CADENCE_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due in days">
          <Input type="number" min={0} value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
        </Field>
        <Field label="First run" hint="Defaults to one cadence after the issue date">
          <Input type="date" value={nextRunAt} onChange={(e) => setNextRunAt(e.target.value)} />
        </Field>
        <Field label="End date (optional)">
          <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}

function SimulateDialog({ open, onClose, inv, onDone }: SubProps) {
  const [amount, setAmount] = useState(String(inv.balance))
  const sim = useMutation({
    mutationFn: () => invoicesApi.simulateCollection(inv.id, Number(amount)),
    onSuccess: (r) => {
      toast.success(r.claimed ? 'Simulated transfer received and applied' : 'Transfer was not matched')
      onDone?.()
      onClose()
    },
    onError: (e) => toast.error(apiError(e)),
  })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Simulate payment"
      description="Mock mode only: pretends a customer transferred money into the collection account."
      footer={
        <>
          <CancelButton onClick={onClose} />
          <Button size="sm" disabled={!(Number(amount) >= 1)} isLoading={sim.isPending} onClick={() => sim.mutate()}>
            Simulate
          </Button>
        </>
      }
    >
      <Field label="Amount">
        <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
    </Dialog>
  )
}

function VoidDialog({ open, onClose, inv, onConfirm, loading }: SubProps & { onConfirm: () => void; loading: boolean }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Void ${inv.number ?? ''}?`}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <Button size="sm" variant="destructive" isLoading={loading} onClick={onConfirm}>
            Void
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-dim">
        The {inv.docType === 'QUOTE' ? 'quote' : 'invoice'} stays on record but can no longer be paid or sent.
        {num(inv.paidAmount) > 0 && ` ${money(inv.paidAmount, inv.currency)} has already been paid against it.`}
      </p>
    </Dialog>
  )
}

function DeleteDialog({ open, onClose, inv, onDeleted }: SubProps & { onDeleted: () => void }) {
  const hasPayments = (inv.payments ?? []).length > 0
  const [conflict, setConflict] = useState<string | null>(null)
  const del = useMutation({
    mutationFn: (force: boolean) => invoicesApi.remove(inv.id, force),
    onSuccess: () => {
      toast.success('Deleted')
      setConflict(null)
      onDeleted()
    },
    onError: (e) => {
      if (apiStatus(e) === 409) setConflict(apiError(e))
      else toast.error(apiError(e))
    },
  })
  const warn = conflict ?? (hasPayments ? `This invoice has ${inv.payments!.length} payment(s) recorded. Deleting it also deletes those payment records. Consider voiding it instead.` : null)
  return (
    <Dialog
      open={open}
      onClose={() => (setConflict(null), onClose())}
      title={`Delete ${inv.number ?? ''}?`}
      footer={
        <>
          <CancelButton onClick={() => (setConflict(null), onClose())} />
          <Button size="sm" variant="destructive" isLoading={del.isPending} onClick={() => del.mutate(!!warn)}>
            {warn ? 'Delete anyway' : 'Delete'}
          </Button>
        </>
      }
    >
      {warn ? (
        <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{warn}</p>
      ) : (
        <p className="text-sm text-text-dim">This permanently removes the {inv.docType === 'QUOTE' ? 'quote' : 'invoice'}.</p>
      )}
    </Dialog>
  )
}
