import { useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { batchesApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatDateTime } from '@/lib/utils'

export default function BatchDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const clientRequestIdRef = useRef(`disburse-${id}-${Math.random().toString(36).slice(2)}`)
  const clientRequestId = clientRequestIdRef.current

  const { data: batch, isLoading } = useQuery({
    queryKey: ['batches', id],
    queryFn: () => batchesApi.get(id!),
    enabled: !!id,
  })

  const approveMutation = useMutation({
    mutationFn: () => batchesApi.approve(id!),
    onSuccess: () => {
      toast.success('Batch approved')
      qc.invalidateQueries({ queryKey: ['batches', id] })
    },
    onError: () => toast.error('Could not approve batch'),
  })

  const disburseMutation = useMutation({
    mutationFn: () => batchesApi.disburse(id!, clientRequestId),
    onSuccess: () => {
      toast.success('Disbursement started')
      qc.invalidateQueries({ queryKey: ['batches', id] })
    },
    onError: () => toast.error('Could not start disbursement'),
  })

  if (isLoading || !batch) {
    return <p className="text-sm text-muted-foreground">Loading batch…</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Batch #{batch.id.slice(0, 8)}</h1>
          <p className="text-sm text-muted-foreground">
            {batch.createdAt ? formatDateTime(batch.createdAt) : ''} · {formatCurrency(batch.totalAmount ?? 0)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={batch.status === 'DISBURSED' ? 'success' : 'outline'}>{batch.status}</Badge>
          {batch.status === 'DRAFT' && (
            <Button onClick={() => approveMutation.mutate()} isLoading={approveMutation.isPending}>
              Approve batch
            </Button>
          )}
          {batch.status === 'APPROVED' && (
            <Button onClick={() => disburseMutation.mutate()} isLoading={disburseMutation.isPending}>
              Disburse
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payout items</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-4">Vendor</th>
                <th className="p-4 text-right">Amount</th>
                <th className="p-4">Payout status</th>
              </tr>
            </thead>
            <tbody>
              {(batch.items ?? []).map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="p-4 font-medium text-foreground">{item.vendorName ?? '—'}</td>
                  <td className="p-4 text-right font-semibold text-foreground">{formatCurrency(item.amount)}</td>
                  <td className="p-4">
                    <Badge variant={item.payoutStatus === 'SUCCESS' ? 'success' : item.payoutStatus === 'FAILED' ? 'destructive' : 'outline'}>
                      {item.payoutStatus ?? 'PENDING'}
                    </Badge>
                  </td>
                </tr>
              ))}
              {(batch.items ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-muted-foreground">
                    No items on this batch.
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
