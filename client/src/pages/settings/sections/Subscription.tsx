import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { apiError, pifBillingApi } from '@/lib/api/shell'
import { usePermissions } from '@/lib/permissions'
import { copyText, naira } from '@/components/layout/shellStore'
import { Chip } from '@/components/layout/Dropdown'
import { SectionCard, Stat, ymd } from '../SectionCard'

/** §5.10 #17 Your Paid In Full subscription. */
export default function Subscription() {
  const qc = useQueryClient()
  const { isAdmin } = usePermissions()
  const { data: sub, isLoading } = useQuery({ queryKey: ['billing', 'pif'], queryFn: pifBillingApi.get })
  const [kycType, setKycType] = useState<'bvn' | 'nin'>('bvn')
  const [kyc, setKyc] = useState('')

  const provision = useMutation({
    mutationFn: () => pifBillingApi.provisionAccount({ [kycType]: kyc.trim() }),
    onSuccess: (s) => {
      qc.setQueryData(['billing', 'pif'], s)
      setKyc('')
      toast.success('Billing account created')
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  return (
    <SectionCard
      title="Your Paid In Full subscription"
      description={sub?.rule ?? 'Pay by the 25th for the next month. Paused if not paid within 7 days of due.'}
      actions={
        sub && (
          <Chip className={sub.paused ? 'border-red/30 bg-red/10 text-red' : sub.overdue ? 'border-orange/30 bg-orange/10 text-orange' : 'border-green/30 bg-green/10 text-green'}>
            {sub.paused ? 'Paused' : sub.overdue ? `Overdue${sub.daysOverdue ? ` · ${sub.daysOverdue}d` : ''}` : sub.status.toLowerCase()}
          </Chip>
        )
      }
    >
      {isLoading || !sub ? (
        <p className="text-sm text-text-dim">{isLoading ? 'Loading…' : 'No subscription details yet.'}</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Tier" value={sub.tier ?? '—'} />
            <Stat label="Per month" value={sub.monthlyAmount == null ? '—' : naira(sub.monthlyAmount)} />
            <Stat label="Next due" value={ymd(sub.nextDueDate)} className={sub.overdue ? 'border-orange/40' : undefined} />
            <Stat label="Paid up to" value={ymd(sub.paidUntil)} />
          </div>
          {sub.overdue && sub.graceEndsAt && !sub.paused && (
            <p className="rounded-lg border border-orange/30 bg-orange/10 px-3 py-2 text-sm text-orange">Payment is overdue. The workspace will be paused on {ymd(sub.graceEndsAt)} if it isn't paid.</p>
          )}

          <div className="rounded-xl border border-border p-4">
            <p className="text-sm font-bold text-foreground">How to pay</p>
            {sub.billingAccount ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-display text-xl font-bold tabular-nums tracking-wider text-foreground">{sub.billingAccount.accountNumber}</p>
                  <p className="text-sm text-text-dim">
                    {sub.billingAccount.bankName} · {sub.billingAccount.accountName}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => ((await copyText(sub.billingAccount!.accountNumber)) ? toast.success('Copied') : toast.error('Copy failed'))}
                >
                  <Copy size={14} /> Copy
                </Button>
                <p className="w-full text-xs text-text-dim">Transfer to this dedicated billing account. Payments are matched automatically.</p>
              </div>
            ) : isAdmin ? (
              <form
                className="mt-2 grid gap-3 sm:grid-cols-[140px_1fr_auto] sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!/^\d{11}$/.test(kyc.trim())) return toast.error(`${kycType.toUpperCase()} must be 11 digits.`)
                  provision.mutate()
                }}
              >
                <p className="text-sm text-text-dim sm:col-span-3">Create your dedicated billing account number. Monnify requires a BVN or NIN.</p>
                <div className="space-y-2">
                  <Label htmlFor="kyc-type">ID type</Label>
                  <Select id="kyc-type" value={kycType} onChange={(e) => setKycType(e.target.value as 'bvn' | 'nin')}>
                    <option value="bvn">BVN</option>
                    <option value="nin">NIN</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="kyc">{kycType.toUpperCase()}</Label>
                  <Input id="kyc" inputMode="numeric" maxLength={11} value={kyc} onChange={(e) => setKyc(e.target.value.replace(/\D/g, ''))} />
                </div>
                <Button type="submit" isLoading={provision.isPending}>
                  Create account
                </Button>
              </form>
            ) : (
              <p className="mt-1 text-sm text-text-dim">An admin needs to create the billing account.</p>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-bold text-foreground">Payment history</p>
            {sub.payments.length === 0 ? (
              <p className="text-sm text-text-dim">No payments recorded yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Reference</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sub.payments.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 tabular-nums">{ymd(p.paidAt)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-text-dim">{p.reference ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{naira(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  )
}
