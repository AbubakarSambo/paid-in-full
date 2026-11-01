import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { walletApi, walletKeys } from '@/lib/api/wallet'
import { fmtDateTime, naira } from '@/components/batches/shared'
import { Pager } from '@/components/wallet/WalletBits'
import type { TopupSource } from '@/types/wallet'
import { SectionCard } from '../SectionCard'

const SOURCE: Record<TopupSource, string> = { WEBHOOK: 'Transfer', MANUAL_RECONCILIATION: 'Reconciled', CARD: 'Card' }

/** §5.10 #16 Top-Up History (includes manual reconciliation entries). */
export default function TopUpHistory() {
  const [page, setPage] = useState(1)
  const q = useQuery({ queryKey: walletKeys.topups(page), queryFn: () => walletApi.topups(page, 20), placeholderData: keepPreviousData })
  const rows = q.data?.data ?? []

  return (
    <SectionCard title="Top-Up History" description="Money received into the wallet account.">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-dim">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Payer</th>
              <th className="px-3 py-2">Reference</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-text-dim">
                  Loading…
                </td>
              </tr>
            )}
            {!q.isLoading && !rows.length && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-text-dim">
                  No top-ups yet.
                </td>
              </tr>
            )}
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap px-3 py-2 text-text-dim">{fmtDateTime(t.paidAt ?? t.createdAt)}</td>
                <td className="px-3 py-2">
                  {t.payerName ?? '—'}
                  {t.payerBank && <span className="block text-xs text-text-dim">{t.payerBank}</span>}
                </td>
                <td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs">{t.reference}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-green">{naira(t.amount)}</td>
                <td className="px-3 py-2">
                  <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim">
                    {SOURCE[t.source] ?? t.source}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager meta={q.data?.meta} onPage={setPage} />
    </SectionCard>
  )
}
