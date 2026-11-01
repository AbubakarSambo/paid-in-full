import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Archive, ArchiveRestore, GitMerge, Pencil, Plus, Search, Trash2, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { apiError, apiStatus, invCustomersApi } from '@/lib/api/invoicing'
import type { InvCustomer } from '@/types/invoicing'
import { CustomerFormDialog } from './CustomerFormDialog'
import { CancelButton, Chip, Dialog, Empty, Field, Segmented, fmtDate, money } from './shared'

export function CustomersTab() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<'active' | 'archived'>('active')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<InvCustomer | null | undefined>(undefined)
  const [merging, setMerging] = useState<InvCustomer | null>(null)
  const [deleting, setDeleting] = useState<InvCustomer | null>(null)
  const [creditsFor, setCreditsFor] = useState<InvCustomer | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['inv-customers', status, search, page],
    queryFn: () => invCustomersApi.list({ status, search: search || undefined, page, limit: 50 }),
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []
  const invalidate = () => qc.invalidateQueries({ queryKey: ['inv-customers'] })

  const toggleArchive = useMutation({
    mutationFn: (c: InvCustomer) => (c.isArchived ? invCustomersApi.restore(c.id) : invCustomersApi.archive(c.id)),
    onSuccess: (c) => {
      toast.success(c.isArchived ? 'Customer archived' : 'Customer restored')
      invalidate()
    },
    onError: (e) => toast.error(apiError(e)),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
          <Input className="pl-9" placeholder="Search name, email, phone, TIN" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        </div>
        <Button size="sm" onClick={() => setEditing(null)}>
          <Plus size={14} /> New customer
        </Button>
      </div>

      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : rows.length === 0 ? (
        <Empty>{status === 'archived' ? 'No archived customers.' : 'No customers yet. Add your first one.'}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface2 text-[10px] uppercase tracking-wider text-text-dim">
              <tr>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Contact</th>
                <th className="px-3 py-2 text-right">Invoices</th>
                <th className="px-3 py-2 text-right">Outstanding</th>
                <th className="px-3 py-2 text-right">Credit</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-semibold">{c.name}</div>
                    {c.taxId && <div className="text-xs text-text-dim">TIN {c.taxId}</div>}
                  </td>
                  <td className="px-3 py-2 text-text-dim">
                    <div>{c.email ?? '—'}</div>
                    <div className="text-xs">{c.phone}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.invoiceCount ?? 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(c.outstanding)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {(c.openCredit ?? 0) > 0 ? <span className="text-green">{money(c.openCredit)}</span> : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <IconBtn title="Credits" onClick={() => setCreditsFor(c)}>
                        <Wallet size={14} />
                      </IconBtn>
                      <IconBtn title="Edit" onClick={() => setEditing(c)}>
                        <Pencil size={14} />
                      </IconBtn>
                      {!c.isArchived && (
                        <IconBtn title="Merge a duplicate into this customer" onClick={() => setMerging(c)}>
                          <GitMerge size={14} />
                        </IconBtn>
                      )}
                      <IconBtn title={c.isArchived ? 'Restore' : 'Archive'} onClick={() => toggleArchive.mutate(c)}>
                        {c.isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                      </IconBtn>
                      <IconBtn title="Delete" danger onClick={() => setDeleting(c)}>
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
      {data && data.meta.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <span className="text-text-dim">
            {page} / {data.meta.totalPages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}

      <CustomerFormDialog open={editing !== undefined} onClose={() => setEditing(undefined)} customer={editing} />
      <MergeDialog keep={merging} onClose={() => setMerging(null)} />
      <DeleteCustomerDialog customer={deleting} onClose={() => setDeleting(null)} />
      <CustomerCreditsDialog customer={creditsFor} onClose={() => setCreditsFor(null)} />
    </div>
  )
}

export function IconBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`rounded-lg p-2 text-text-dim transition-colors ${danger ? 'hover:bg-red/10 hover:text-red' : 'hover:bg-gold/10 hover:text-gold'}`}
    >
      {children}
    </button>
  )
}

function MergeDialog({ keep, onClose }: { keep: InvCustomer | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [keepId, setKeepId] = useState('')
  const [mergeId, setMergeId] = useState('')
  const { data } = useQuery({
    queryKey: ['inv-customers', 'merge-picker'],
    queryFn: () => invCustomersApi.list({ status: 'all', limit: 100 }),
    enabled: !!keep,
  })
  const all = (data?.data ?? []).filter((c) => !c.mergedIntoId)
  const effectiveKeep = keepId || keep?.id || ''
  const merge = useMutation({
    mutationFn: () => invCustomersApi.merge(effectiveKeep, mergeId),
    onSuccess: (r) => {
      const m = r.moved
      toast.success(`Merged: ${m.invoices ?? 0} invoices, ${m.credits ?? 0} credits, ${m.subscriptions ?? 0} subscriptions moved`)
      qc.invalidateQueries({ queryKey: ['inv-customers'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      setKeepId('')
      setMergeId('')
      onClose()
    },
    onError: (e) => toast.error(apiError(e)),
  })
  const keepName = all.find((c) => c.id === effectiveKeep)?.name ?? keep?.name
  const mergeName = all.find((c) => c.id === mergeId)?.name
  return (
    <Dialog
      open={!!keep}
      onClose={onClose}
      title="Merge duplicate customers"
      description="Invoices, credits, subscriptions and schedules move to the customer you keep. The duplicate is archived."
      footer={
        <>
          <CancelButton onClick={onClose} />
          <Button size="sm" disabled={!mergeId || mergeId === effectiveKeep} isLoading={merge.isPending} onClick={() => merge.mutate()}>
            Merge
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Keep">
          <Select value={effectiveKeep} onChange={(e) => setKeepId(e.target.value)}>
            {all.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.email ? ` · ${c.email}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Merge into it (duplicate)">
          <Select value={mergeId} onChange={(e) => setMergeId(e.target.value)}>
            <option value="">Pick the duplicate…</option>
            {all
              .filter((c) => c.id !== effectiveKeep)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.email ? ` · ${c.email}` : ''}
                  {c.isArchived ? ' (archived)' : ''}
                </option>
              ))}
          </Select>
        </Field>
        {mergeName && (
          <p className="text-sm text-text-dim">
            <b className="text-foreground">{mergeName}</b> will be merged into <b className="text-foreground">{keepName}</b>.
          </p>
        )}
      </div>
    </Dialog>
  )
}

function DeleteCustomerDialog({ customer, onClose }: { customer: InvCustomer | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const del = useMutation({
    mutationFn: () => invCustomersApi.remove(customer!.id),
    onSuccess: () => {
      toast.success('Customer deleted')
      qc.invalidateQueries({ queryKey: ['inv-customers'] })
      close()
    },
    onError: (e) => (apiStatus(e) === 409 ? setError(apiError(e)) : toast.error(apiError(e))),
  })
  const close = () => {
    setError(null)
    onClose()
  }
  return (
    <Dialog
      open={!!customer}
      onClose={close}
      title={`Delete ${customer?.name ?? ''}?`}
      footer={
        <>
          <CancelButton onClick={close} />
          {!error && (
            <Button size="sm" variant="destructive" isLoading={del.isPending} onClick={() => del.mutate()}>
              Delete
            </Button>
          )}
        </>
      }
    >
      {error ? (
        <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{error}</p>
      ) : (
        <p className="text-sm text-text-dim">
          Customers can only be deleted when they have no invoices.
          {(customer?.invoiceCount ?? 0) > 0 && ` This one has ${customer?.invoiceCount}; archive it instead.`}
        </p>
      )}
    </Dialog>
  )
}

function CustomerCreditsDialog({ customer, onClose }: { customer: InvCustomer | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const { data: credits = [], isLoading } = useQuery({
    queryKey: ['inv-customer-credits', customer?.id],
    queryFn: () => invCustomersApi.credits(customer!.id),
    enabled: !!customer,
  })
  const add = useMutation({
    mutationFn: () => invCustomersApi.addCredit(customer!.id, { amount: Number(amount), reason: reason.trim() || undefined }),
    onSuccess: () => {
      toast.success('Credit issued')
      setAmount('')
      setReason('')
      qc.invalidateQueries({ queryKey: ['inv-customer-credits'] })
      qc.invalidateQueries({ queryKey: ['inv-customers'] })
      qc.invalidateQueries({ queryKey: ['credits'] })
    },
    onError: (e) => toast.error(apiError(e)),
  })
  return (
    <Dialog open={!!customer} onClose={onClose} title={`Credits · ${customer?.name ?? ''}`} size="lg">
      <div className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-text-dim">Loading…</p>
        ) : credits.length === 0 ? (
          <p className="text-sm text-text-dim">No credits.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {credits.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="font-semibold tabular-nums">{money(c.amount)}</span>{' '}
                  <Chip tone={c.status === 'OPEN' ? 'green' : c.status === 'REFUNDED' ? 'orange' : 'dim'}>{c.status}</Chip>
                  <div className="text-xs text-text-dim">
                    {c.note ?? '—'} · {fmtDate(c.createdAt)}
                    {c.appliedToInvoice?.invoiceNumber && ` · applied to ${c.appliedToInvoice.invoiceNumber}`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-[140px_1fr_auto]">
          <Input type="number" min={0} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" className="h-11" disabled={!(Number(amount) > 0)} isLoading={add.isPending} onClick={() => add.mutate()}>
            Issue credit
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
