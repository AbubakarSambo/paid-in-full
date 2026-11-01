import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { toNumber } from '@/lib/money'
import { walletApi, walletKeys } from '@/lib/api/wallet'
import { fmtDateTime, naira } from '@/components/batches/shared'
import { Pager } from '@/components/wallet/WalletBits'
import type { LedgerDirection, LedgerQuery, LedgerStatus, LedgerType } from '@/types/wallet'
import { SectionCard } from '../SectionCard'

const TYPES: Record<LedgerType, string> = {
  TOPUP: 'Top-up',
  SWEEP_IN: 'Sweep in',
  DISBURSEMENT: 'Disbursement',
  FEE: 'Fee',
  REFUND: 'Refund',
  ADJUSTMENT: 'Adjustment',
  WHT_WITHHOLDING: 'WHT',
}

const STATUS_CLS: Record<LedgerStatus, string> = {
  PENDING: 'text-purple',
  COMPLETED: 'text-green',
  FAILED: 'text-red',
  REVERSED: 'text-orange',
}

/** §5.10 #25 Wallet Ledger: every ledger entry. */
export default function WalletLedger() {
  const [query, setQuery] = useState<LedgerQuery>({ page: 1, limit: 25 })
  const q = useQuery({ queryKey: walletKeys.ledger(query), queryFn: () => walletApi.ledger(query), placeholderData: keepPreviousData })
  const rows = q.data?.data ?? []
  const set = (patch: Partial<LedgerQuery>) => setQuery((s) => ({ ...s, ...patch, page: patch.page ?? 1 }))

  return (
    <SectionCard title="Wallet Ledger" description="Every movement in and out of the wallet.">
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select value={query.type ?? ''} onChange={(e) => set({ type: (e.target.value || undefined) as LedgerType | undefined })}>
          <option value="">All types</option>
          {Object.entries(TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select value={query.direction ?? ''} onChange={(e) => set({ direction: (e.target.value || undefined) as LedgerDirection | undefined })}>
          <option value="">In & out</option>
          <option value="IN">In</option>
          <option value="OUT">Out</option>
        </Select>
        <Select value={query.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as LedgerStatus | undefined })}>
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
          <option value="REVERSED">Reversed</option>
        </Select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-dim">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Reference</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Balance after</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-text-dim">
                  Loading…
                </td>
              </tr>
            )}
            {!q.isLoading && !rows.length && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-text-dim">
                  No ledger entries.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const amt = toNumber(r.amount)
              const signed = r.direction === 'OUT' ? -Math.abs(amt) : Math.abs(amt)
              return (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-text-dim">{fmtDateTime(r.postedAt)}</td>
                  <td className="px-3 py-2">{TYPES[r.type] ?? r.type}</td>
                  <td className="px-3 py-2 text-text-dim">{r.actorName ?? (r.type === 'TOPUP' ? 'Bank transfer' : '—')}</td>
                  <td className="max-w-[240px] px-3 py-2">
                    <span className="line-clamp-2 text-xs">{r.description ?? '—'}</span>
                    {r.batch?.batchRef && <span className="block font-mono text-[10px] text-text-muted">{r.batch.batchRef}</span>}
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-2 font-mono text-[11px] text-text-dim">{r.reference ?? '—'}</td>
                  <td className={cn('px-3 py-2 text-[11px] font-semibold uppercase tracking-wider', STATUS_CLS[r.status])}>{r.status}</td>
                  <td className={cn('whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums', signed < 0 ? 'text-red' : 'text-green')}>
                    {signed < 0 ? '−' : '+'}
                    {naira(Math.abs(signed))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-dim">{r.balanceAfter != null ? naira(r.balanceAfter) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Pager meta={q.data?.meta} onPage={(page) => setQuery((s) => ({ ...s, page }))} />
    </SectionCard>
  )
}
