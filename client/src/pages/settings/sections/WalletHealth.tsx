import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/lib/permissions'
import { apiErrorMessage } from '@/lib/api/batches'
import { walletApi, walletKeys } from '@/lib/api/wallet'
import { naira } from '@/components/batches/shared'
import { HealthBadge } from '@/components/wallet/WalletBits'
import { SectionCard, Stat } from '../SectionCard'

/** §5.10 #15 Wallet Health. */
export default function WalletHealth() {
  const qc = useQueryClient()
  const { canPay } = usePermissions()
  const q = useQuery({ queryKey: walletKeys.summary, queryFn: walletApi.summary })
  const [busy, setBusy] = useState(false)
  const w = q.data

  const reconcile = async () => {
    setBusy(true)
    try {
      const r = await walletApi.reconcileTopups()
      toast.success(r.message)
      qc.invalidateQueries({ queryKey: walletKeys.all })
    } catch (err) {
      toast.error(await apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="Wallet Health"
      description="Current balance = confirmed credits − completed and in-flight debits."
      actions={
        canPay && (
          <Button variant="outline" size="sm" isLoading={busy} onClick={reconcile}>
            <RefreshCw size={13} /> Reconcile now
          </Button>
        )
      }
    >
      {q.isLoading || !w ? (
        <p className="text-sm text-text-dim">{q.isError ? "Couldn't load the wallet." : 'Loading…'}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <HealthBadge status={w.health.status} label={w.health.label} />
            <span className="text-sm text-text-dim">{w.health.message}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Current balance" value={<span className={w.balance < 0 ? 'text-red' : 'text-gold'}>{naira(w.balance)}</span>} />
            <Stat label="Ready to send" value={naira(w.readyToSend)} />
            <Stat label="Clearing" value={naira(w.clearing)} />
            <Stat label="Inflows (24h)" value={<>{naira(w.inflows24h.amount)} <span className="text-xs font-normal text-text-dim">· {w.inflows24h.count}</span></>} />
          </div>
          <div className="rounded-xl border border-border bg-surface2 p-4 text-sm">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">How the balance is worked out</p>
            <dl className="space-y-1 tabular-nums">
              <Line label="Confirmed credits (top-ups)" value={naira(w.confirmedCredits)} />
              <Line label="− Completed debits (paid out)" value={naira(w.completedDebits)} />
              <Line label="− In-flight debits (sending now)" value={naira(w.inFlightDebits)} />
              <div className="border-t border-border pt-1">
                <Line label="= Current balance" value={naira(w.balance)} strong />
              </div>
            </dl>
            <p className="mt-2 text-xs text-text-dim">
              Clearing credits ({naira(w.clearing)}) are seen but not yet confirmed and can't be sent yet.
              {w.health.needed > 0 && ` Open batches need ${naira(w.health.needed)} in total.`}
            </p>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={strong ? 'font-semibold' : 'text-text-dim'}>{label}</dt>
      <dd className={strong ? 'font-bold' : undefined}>{value}</dd>
    </div>
  )
}
