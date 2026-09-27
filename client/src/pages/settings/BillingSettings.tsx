import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useState } from 'react'
import { billingApi, walletApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'

interface Plan {
  id: string
  name: string
  price: number
  [key: string]: unknown
}

export default function BillingSettings() {
  const qc = useQueryClient()
  const [topupAmount, setTopupAmount] = useState('')

  const { data: wallet } = useQuery({ queryKey: ['wallet', 'balance'], queryFn: walletApi.balance })
  const { data: plans } = useQuery({ queryKey: ['billing', 'plans'], queryFn: billingApi.plans })
  const { data: subscription } = useQuery({ queryKey: ['billing', 'subscription'], queryFn: billingApi.subscription })

  const topupMutation = useMutation({
    mutationFn: () => walletApi.topup({ amount: Number(topupAmount) }),
    onSuccess: () => {
      toast.success('Top-up initiated')
      setTopupAmount('')
      qc.invalidateQueries({ queryKey: ['wallet'] })
    },
    onError: () => toast.error('Could not initiate top-up'),
  })

  const upgradeMutation = useMutation({
    mutationFn: billingApi.upgrade,
    onSuccess: () => {
      toast.success('Plan updated')
      qc.invalidateQueries({ queryKey: ['billing', 'subscription'] })
    },
    onError: () => toast.error('Could not update plan'),
  })

  const planList: Plan[] = (Array.isArray(plans) ? plans : (plans as { data?: Plan[] })?.data ?? []) as Plan[]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <p className="text-3xl font-bold text-foreground">{wallet ? formatCurrency(wallet.balance) : '—'}</p>
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="Amount to top up"
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
            />
            <Button disabled={!topupAmount} isLoading={topupMutation.isPending} onClick={() => topupMutation.mutate()}>
              Top up
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Current plan: <span className="font-semibold text-foreground">{(subscription as { planName?: string })?.planName ?? 'Free'}</span>
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {planList.map((plan) => (
              <div key={plan.id} className="rounded-xl border border-border p-4">
                <p className="font-semibold text-foreground">{plan.name}</p>
                <p className="mt-1 text-lg font-bold text-gold">{formatCurrency(plan.price)}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full"
                  isLoading={upgradeMutation.isPending}
                  onClick={() => upgradeMutation.mutate({ planId: plan.id })}
                >
                  Select
                </Button>
              </div>
            ))}
            {planList.length === 0 && <p className="text-sm text-muted-foreground">No plans available.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
