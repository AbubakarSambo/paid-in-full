import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { batchesApi } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatDateTime } from '@/lib/utils'

const STATUS_VARIANT: Record<string, 'success' | 'outline' | 'warning' | 'destructive'> = {
  DISBURSED: 'success',
  APPROVED: 'outline',
  DISBURSING: 'warning',
  FAILED: 'destructive',
  DRAFT: 'outline',
}

export default function BatchesPage() {
  const { data, isLoading } = useQuery({ queryKey: ['batches'], queryFn: () => batchesApi.list({ limit: 100 }) })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Batches</h1>
        <p className="text-sm text-muted-foreground">Approve and disburse grouped payments.</p>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-4">Batch</th>
                <th className="p-4">Created</th>
                <th className="p-4">Items</th>
                <th className="p-4 text-right">Total</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {data?.data.map((batch) => (
                <tr key={batch.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                  <td className="p-4">
                    <Link to={`/batches/${batch.id}`} className="font-medium text-gold hover:underline">
                      #{batch.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="p-4 text-muted-foreground">{batch.createdAt ? formatDateTime(batch.createdAt) : '—'}</td>
                  <td className="p-4 text-muted-foreground">{batch.itemCount ?? '—'}</td>
                  <td className="p-4 text-right font-semibold text-foreground">
                    {formatCurrency(batch.totalAmount ?? 0)}
                  </td>
                  <td className="p-4">
                    <Badge variant={STATUS_VARIANT[batch.status] ?? 'outline'}>{batch.status}</Badge>
                  </td>
                </tr>
              ))}
              {!isLoading && data?.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    No batches yet. Create one from the Queue page.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
