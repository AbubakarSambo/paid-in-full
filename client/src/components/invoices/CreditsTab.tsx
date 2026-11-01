import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { apiError, creditsApi } from '@/lib/api/invoicing'
import type { CreditStatus, CustomerCredit } from '@/types/invoicing'
import { CancelButton, Chip, Dialog, Empty, Kpi, Segmented, fmtDate, money } from './shared'

export function CreditsTab() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<CreditStatus | 'ALL'>('OPEN')
  const [page, setPage] = useState(1)
  const [refunding, setRefunding] = useState<CustomerCredit | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['credits', status, page],
    queryFn: () => creditsApi.list({ status: status === 'ALL' ? undefined : status, page, limit: 50 }),
    placeholderData: keepPreviousData,
  })
  const refund = useMutation({
    mutationFn: (id: string) => creditsApi.refund(id),
    onSuccess: () => {
      toast.success('Credit marked as refunded')
      qc.invalidateQueries({ queryKey: ['credits'] })
      qc.invalidateQueries({ queryKey: ['inv-customers'] })
      setRefunding(null)
    },
    onError: (e) => toast.error(apiError(e)),
  })
  const rows = data?.data ?? []
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Segmented
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          options={[
            { value: 'OPEN', label: 'Open' },
            { value: 'APPLIED', label: 'Applied' },
            { value: 'REFUNDED', label: 'Refunded' },
            { value: 'ALL', label: 'All' },
          ]}
        />
        <div className="w-full sm:w-60">
          <Kpi label="Open credit (all customers)" value={money(data?.openTotal ?? 0)} tone="green" />
        </div>
      </div>
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : rows.length === 0 ? (
        <Empty>No credits. Overpayments become customer credits automatically.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface2 text-[10px] uppercase tracking-wider text-text-dim">
              <tr>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Note</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-semibold">{c.customer?.name ?? '—'}</div>
                    <div className="text-xs text-text-dim">{fmtDate(c.createdAt)}</div>
                  </td>
                  <td className="px-3 py-2 text-text-dim">
                    {c.note ?? '—'}
                    {c.sourceInvoice?.invoiceNumber && <div className="text-xs">from {c.sourceInvoice.invoiceNumber}</div>}
                    {c.appliedToInvoice?.invoiceNumber && <div className="text-xs">applied to {c.appliedToInvoice.invoiceNumber}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <Chip tone={c.status === 'OPEN' ? 'green' : c.status === 'REFUNDED' ? 'orange' : 'dim'}>{c.status}</Chip>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(c.amount)}</td>
                  <td className="px-3 py-2 text-right">
                    {c.status === 'OPEN' && (
                      <Button size="sm" variant="outline" onClick={() => setRefunding(c)}>
                        Refund
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.meta.totalPages > 1 && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <Button size="sm" variant="outline" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
      <Dialog
        open={!!refunding}
        onClose={() => setRefunding(null)}
        title="Mark credit as refunded?"
        footer={
          <>
            <CancelButton onClick={() => setRefunding(null)} />
            <Button size="sm" isLoading={refund.isPending} onClick={() => refunding && refund.mutate(refunding.id)}>
              Mark refunded
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-dim">
          Records that {money(refunding?.amount)} was returned to {refunding?.customer?.name ?? 'the customer'} outside the app. The credit can no
          longer be applied to invoices.
        </p>
      </Dialog>
    </div>
  )
}
