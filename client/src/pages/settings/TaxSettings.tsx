import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useState, useEffect } from 'react'
import { whtApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, formatDate } from '@/lib/utils'

interface WhtRate {
  category: string
  rate: number
}
interface LedgerRow {
  id: string
  vendorName?: string
  amount: number
  rate?: number
  createdAt?: string
}

export default function TaxSettings() {
  const qc = useQueryClient()
  const { data: rates } = useQuery({ queryKey: ['wht', 'rates'], queryFn: whtApi.getRates })
  const { data: ledger } = useQuery({ queryKey: ['wht', 'ledger'], queryFn: () => whtApi.ledger() })
  const [editable, setEditable] = useState<WhtRate[]>([])

  useEffect(() => {
    const list = (Array.isArray(rates) ? rates : (rates as { data?: WhtRate[] })?.data ?? []) as WhtRate[]
    setEditable(list)
  }, [rates])

  const updateMutation = useMutation({
    mutationFn: () => whtApi.updateRates({ rates: editable }),
    onSuccess: () => {
      toast.success('WHT rates updated')
      qc.invalidateQueries({ queryKey: ['wht', 'rates'] })
    },
    onError: () => toast.error('Could not update rates'),
  })

  const ledgerRows = (Array.isArray(ledger) ? ledger : (ledger as { data?: LedgerRow[] })?.data ?? []) as LedgerRow[]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Withholding tax rates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {editable.map((rate, i) => (
            <div key={rate.category} className="flex items-center gap-3">
              <span className="w-40 text-sm text-foreground">{rate.category}</span>
              <Input
                type="number"
                step="0.1"
                className="max-w-[120px]"
                value={rate.rate}
                onChange={(e) =>
                  setEditable((prev) => prev.map((r, idx) => (idx === i ? { ...r, rate: Number(e.target.value) } : r)))
                }
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          ))}
          {editable.length === 0 && <p className="text-sm text-muted-foreground">No WHT categories configured yet.</p>}
          <Button isLoading={updateMutation.isPending} onClick={() => updateMutation.mutate()} disabled={editable.length === 0}>
            Save rates
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WHT ledger</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-4">Vendor</th>
                <th className="p-4 text-right">Amount withheld</th>
                <th className="p-4">Rate</th>
                <th className="p-4">Date</th>
              </tr>
            </thead>
            <tbody>
              {ledgerRows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="p-4 font-medium text-foreground">{row.vendorName ?? '—'}</td>
                  <td className="p-4 text-right font-semibold text-foreground">{formatCurrency(row.amount)}</td>
                  <td className="p-4 text-muted-foreground">{row.rate ? `${row.rate}%` : '—'}</td>
                  <td className="p-4 text-muted-foreground">{row.createdAt ? formatDate(row.createdAt) : '—'}</td>
                </tr>
              ))}
              {ledgerRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted-foreground">
                    No WHT entries yet.
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
