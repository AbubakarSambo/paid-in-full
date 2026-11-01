import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { invoicesApi } from '@/lib/api/invoicing'
import type { InvoiceStatus } from '@/types/invoicing'
import { Empty, Segmented, StatusChip, fmtDate, money } from './shared'

type Filter = 'all' | 'draft' | 'sent' | 'paid' | 'overdue'
const FILTER_STATUS: Record<Filter, InvoiceStatus | undefined> = {
  all: undefined,
  draft: 'DRAFT',
  sent: 'SENT',
  paid: 'PAID',
  overdue: 'OVERDUE',
}

export function InvoicesTab({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', filter, search, page],
    queryFn: () => invoicesApi.list({ status: FILTER_STATUS[filter], search: search.trim() || undefined, page, limit: 25 }),
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={filter}
          onChange={(v) => (setFilter(v), setPage(1))}
          options={[
            { value: 'all', label: 'All' },
            { value: 'draft', label: 'Draft' },
            { value: 'sent', label: 'Sent' },
            { value: 'paid', label: 'Paid' },
            { value: 'overdue', label: 'Overdue' },
          ]}
        />
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
          <Input className="pl-9" placeholder="Search number or customer" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        </div>
        <Button size="sm" onClick={onNew}>
          <Plus size={14} /> New invoice
        </Button>
      </div>

      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : rows.length === 0 ? (
        <Empty>{search || filter !== 'all' ? 'No invoices match.' : 'No invoices yet. Create your first one.'}</Empty>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 sm:hidden">
            {rows.map((i) => (
              <button key={i.id} onClick={() => onOpen(i.id)} className="w-full rounded-xl border border-border bg-card p-3 text-left">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">{i.number ?? 'Draft'}</span>
                  <span className="font-semibold tabular-nums">{money(i.balance > 0 ? i.balance : i.amountDue, i.currency)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-text-dim">
                  <span className="truncate">{i.customer?.name}</span>
                  <StatusChip status={i.status} quote={i.docType === 'QUOTE'} expired={i.isQuoteExpired} />
                </div>
              </button>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-card sm:block">
            <table className="w-full text-sm">
              <thead className="bg-surface2 text-[10px] uppercase tracking-wider text-text-dim">
                <tr>
                  <th className="px-3 py-2 text-left">Number</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">Issued</th>
                  <th className="px-3 py-2 text-left">Due</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Amount due</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} onClick={() => onOpen(i.id)} className="cursor-pointer border-t border-border hover:bg-surface2/60">
                    <td className="px-3 py-2 font-semibold">{i.number ?? '—'}</td>
                    <td className="px-3 py-2">{i.customer?.name}</td>
                    <td className="px-3 py-2 text-text-dim">{fmtDate(i.issueDate)}</td>
                    <td className="px-3 py-2 text-text-dim">{i.docType === 'QUOTE' ? `exp ${fmtDate(i.quoteExpiresAt)}` : fmtDate(i.dueDate)}</td>
                    <td className="px-3 py-2">
                      <StatusChip status={i.status} quote={i.docType === 'QUOTE'} expired={i.isQuoteExpired} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(i.amountDue, i.currency)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(i.balance, i.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
    </div>
  )
}
