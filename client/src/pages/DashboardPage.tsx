import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Wallet, ListChecks, Layers, FileSpreadsheet } from 'lucide-react'
import { walletApi, queueApi, batchesApi, requisitionsApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export default function DashboardPage() {
  const { data: wallet } = useQuery({ queryKey: ['wallet', 'balance'], queryFn: walletApi.balance })
  const { data: queue } = useQuery({ queryKey: ['queue', 'summary'], queryFn: () => queueApi.list({ limit: 5 }) })
  const { data: batches } = useQuery({ queryKey: ['batches', 'summary'], queryFn: () => batchesApi.list({ limit: 5 }) })
  const { data: reqs } = useQuery({
    queryKey: ['requisitions', 'pending'],
    queryFn: () => requisitionsApi.list({ status: 'PENDING', limit: 5 }),
  })

  const stats = [
    { label: 'Wallet balance', value: wallet ? formatCurrency(wallet.balance) : '—', icon: Wallet, to: '/settings/billing' },
    { label: 'In queue', value: queue?.meta.total ?? '—', icon: ListChecks, to: '/queue' },
    { label: 'Open batches', value: batches?.meta.total ?? '—', icon: Layers, to: '/batches' },
    { label: 'Pending requisitions', value: reqs?.meta.total ?? '—', icon: FileSpreadsheet, to: '/requisitions' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Everything about your disbursement pipeline at a glance.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, to }) => (
          <Link key={label} to={to}>
            <Card className="hover:border-gold/40 transition-colors">
              <CardContent className="p-5 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-gold/15 flex items-center justify-center text-gold">
                  <Icon size={20} />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Latest queue items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {queue?.data.length ? (
              queue.data.map((item) => (
                <div key={item.id} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.vendorName ?? 'Unnamed vendor'}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{formatCurrency(item.amount)}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No items in the queue yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent batches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {batches?.data.length ? (
              batches.data.map((batch) => (
                <Link
                  key={batch.id}
                  to={`/batches/${batch.id}`}
                  className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">Batch #{batch.id.slice(0, 8)}</p>
                    <p className="text-xs text-muted-foreground">
                      {batch.createdAt ? formatDateTime(batch.createdAt) : ''}
                    </p>
                  </div>
                  <Badge variant={batch.status === 'DISBURSED' ? 'success' : 'outline'}>{batch.status}</Badge>
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No batches yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
