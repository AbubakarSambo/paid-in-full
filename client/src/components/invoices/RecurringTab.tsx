import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FilePlus2, Pause, Play, Plus, RefreshCw, Trash2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { apiError, invCustomersApi, invoicesApi, recurrencesApi, templatesApi } from '@/lib/api/invoicing'
import type { Invoice, InvoiceRecurrence, InvoiceTemplate } from '@/types/invoicing'
import { IconBtn } from './CustomersTab'
import { RecurrenceDialog } from './InvoiceDetail'
import { CADENCE_LABEL, CancelButton, Chip, Dialog, Empty, Field, fmtDate, money, num } from './shared'

export function RecurringTab({ onOpenInvoice }: { onOpenInvoice: (id: string) => void }) {
  const qc = useQueryClient()
  const [fromInvoiceOpen, setFromInvoiceOpen] = useState(false)
  const [deleting, setDeleting] = useState<InvoiceRecurrence | null>(null)
  const [useTemplate, setUseTemplate] = useState<InvoiceTemplate | null>(null)
  const { data: recurrences = [], isLoading } = useQuery({ queryKey: ['invoice-recurrences'], queryFn: recurrencesApi.list })
  const { data: templates = [] } = useQuery({ queryKey: ['invoice-templates'], queryFn: templatesApi.list })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['invoice-recurrences'] })
    qc.invalidateQueries({ queryKey: ['invoices'] })
  }
  const runDue = useMutation({
    mutationFn: recurrencesApi.runDue,
    onSuccess: (r) => {
      const errors = r.results.filter((x) => x.error)
      toast.success(r.generated ? `${r.generated} draft(s) generated for review` : 'Nothing due today')
      if (errors.length) toast.error(`${errors.length} schedule(s) failed: ${errors[0].error}`)
      invalidate()
    },
    onError: (e) => toast.error(apiError(e)),
  })
  const runOne = useMutation({
    mutationFn: recurrencesApi.runOne,
    onSuccess: (r) => {
      if (r.invoiceId) {
        toast.success(`Draft ${r.invoiceNumber ?? ''} generated`)
        onOpenInvoice(r.invoiceId)
      } else toast.error(r.error ?? `Skipped: ${r.skipped ?? 'nothing to generate'}`)
      invalidate()
    },
    onError: (e) => toast.error(apiError(e)),
  })
  const toggle = useMutation({
    mutationFn: (r: InvoiceRecurrence) => recurrencesApi.update(r.id, { isActive: !r.isActive }),
    onSuccess: (r) => (toast.success(r.isActive ? 'Schedule resumed' : 'Schedule paused'), invalidate()),
    onError: (e) => toast.error(apiError(e)),
  })
  const del = useMutation({
    mutationFn: (id: string) => recurrencesApi.remove(id),
    onSuccess: () => (toast.success('Schedule deleted'), setDeleting(null), invalidate()),
    onError: (e) => toast.error(apiError(e)),
  })
  const delTemplate = useMutation({
    mutationFn: (id: string) => templatesApi.remove(id),
    onSuccess: () => (toast.success('Template deleted'), qc.invalidateQueries({ queryKey: ['invoice-templates'] })),
    onError: (e) => toast.error(apiError(e)),
  })

  const scheduleTotal = (r: InvoiceRecurrence) =>
    (r.templateItems ?? []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-dim">Schedules create drafts; nothing is sent until you review it.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setFromInvoiceOpen(true)}>
            <Plus size={14} /> From an invoice
          </Button>
          <Button size="sm" isLoading={runDue.isPending} onClick={() => runDue.mutate()}>
            <RefreshCw size={14} /> Generate drafts for review and sending
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : recurrences.length === 0 ? (
        <Empty>No recurring invoices. Open an invoice and choose “Make recurring”, or use “From an invoice”.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface2 text-[10px] uppercase tracking-wider text-text-dim">
              <tr>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Cadence</th>
                <th className="px-3 py-2 text-left">Next run</th>
                <th className="px-3 py-2 text-left">Ends</th>
                <th className="px-3 py-2 text-right">Per run</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {recurrences.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-semibold">{r.customer?.name ?? '—'}</div>
                    <div className="text-xs text-text-dim">
                      {(r.invoices ?? []).length
                        ? `Last: ${r.invoices![0].invoiceNumber ?? 'draft'} · ${fmtDate(r.invoices![0].issueDate)}`
                        : 'No invoices generated yet'}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Chip tone="gold">{CADENCE_LABEL[r.interval]}</Chip> {!r.isActive && <Chip>Paused</Chip>}
                  </td>
                  <td className="px-3 py-2">{fmtDate(r.nextRunAt)}</td>
                  <td className="px-3 py-2 text-text-dim">{r.endsAt ? fmtDate(r.endsAt) : 'No end'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(scheduleTotal(r), r.currency)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <IconBtn title="Run now (generate a draft)" onClick={() => runOne.mutate(r.id)}>
                        <Zap size={14} />
                      </IconBtn>
                      <IconBtn title={r.isActive ? 'Pause' : 'Resume'} onClick={() => toggle.mutate(r)}>
                        {r.isActive ? <Pause size={14} /> : <Play size={14} />}
                      </IconBtn>
                      <IconBtn title="Delete" danger onClick={() => setDeleting(r)}>
                        <Trash2 size={14} />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">Templates</h3>
        {templates.length === 0 ? (
          <Empty>No templates. Open an invoice and choose “Save as template”.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <div key={t.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-text-dim">
                      {t.items.length} line(s) · {money(t.items.reduce((s, it) => s + num(it.quantity) * num(it.unitPrice), 0), t.currency ?? 'NGN')}
                    </div>
                  </div>
                  <IconBtn title="Delete template" danger onClick={() => delTemplate.mutate(t.id)}>
                    <Trash2 size={14} />
                  </IconBtn>
                </div>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => setUseTemplate(t)}>
                  <FilePlus2 size={14} /> New invoice
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <FromInvoiceDialog open={fromInvoiceOpen} onClose={() => setFromInvoiceOpen(false)} />
      <UseTemplateDialog template={useTemplate} onClose={() => setUseTemplate(null)} onCreated={onOpenInvoice} />
      <Dialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete schedule?"
        footer={
          <>
            <CancelButton onClick={() => setDeleting(null)} />
            <Button size="sm" variant="destructive" isLoading={del.isPending} onClick={() => deleting && del.mutate(deleting.id)}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-dim">Invoices already generated are kept.</p>
      </Dialog>
    </div>
  )
}

function FromInvoiceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [picked, setPicked] = useState<Invoice | null>(null)
  const [id, setId] = useState('')
  const { data } = useQuery({
    queryKey: ['invoices', 'recurrence-picker'],
    queryFn: () => invoicesApi.list({ docType: 'INVOICE', limit: 100 }),
    enabled: open,
  })
  const invoices = (data?.data ?? []).filter((i) => i.status !== 'VOID')
  const close = () => {
    setId('')
    onClose()
  }
  if (picked) return <RecurrenceDialog open inv={picked} onClose={() => (setPicked(null), close())} />
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Recurring from an invoice"
      footer={
        <>
          <CancelButton onClick={close} />
          <Button size="sm" disabled={!id} onClick={() => setPicked(invoices.find((i) => i.id === id) ?? null)}>
            Next
          </Button>
        </>
      }
    >
      <Field label="Invoice">
        <Select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Pick an invoice…</option>
          {invoices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.number} · {i.customer?.name} · {money(i.amountDue, i.currency)}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  )
}

function UseTemplateDialog({
  template,
  onClose,
  onCreated,
}: {
  template: InvoiceTemplate | null
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const qc = useQueryClient()
  const [customerId, setCustomerId] = useState('')
  const { data } = useQuery({
    queryKey: ['inv-customers', 'picker'],
    queryFn: () => invCustomersApi.list({ status: 'active', limit: 100 }),
    enabled: !!template,
  })
  const create = useMutation({
    mutationFn: () => invoicesApi.fromTemplate(template!.id, { customerId }),
    onSuccess: (inv) => {
      toast.success(`Draft ${inv.number ?? ''} created from template`)
      qc.invalidateQueries({ queryKey: ['invoices'] })
      setCustomerId('')
      onClose()
      onCreated(inv.id)
    },
    onError: (e) => toast.error(apiError(e)),
  })
  return (
    <Dialog
      open={!!template}
      onClose={onClose}
      title={`New invoice from “${template?.name ?? ''}”`}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <Button size="sm" disabled={!customerId} isLoading={create.isPending} onClick={() => create.mutate()}>
            Create draft
          </Button>
        </>
      }
    >
      <Field label="Customer">
        <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">Select a customer…</option>
          {(data?.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  )
}
