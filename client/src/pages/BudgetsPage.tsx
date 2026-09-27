import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts'
import { Upload, Trash2 } from 'lucide-react'
import { budgetsApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'

interface VarianceRow {
  category?: string
  costCenter?: string
  budgeted: number
  actual: number
  variance?: number
  [key: string]: unknown
}

export default function BudgetsPage() {
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7))

  const { data: budgets, isLoading } = useQuery({ queryKey: ['budgets'], queryFn: () => budgetsApi.list({ limit: 100 }) })
  const { data: variance } = useQuery({
    queryKey: ['budgets', 'variance', period],
    queryFn: () => budgetsApi.variance(period),
  })

  const importMutation = useMutation({
    mutationFn: budgetsApi.import,
    onSuccess: () => {
      toast.success('Budgets imported')
      qc.invalidateQueries({ queryKey: ['budgets'] })
    },
    onError: () => toast.error('Import failed'),
  })

  const removeMutation = useMutation({
    mutationFn: budgetsApi.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  })

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => importMutation.mutate(String(reader.result))
    reader.readAsText(file)
    e.target.value = ''
  }

  const varianceRows: VarianceRow[] = Array.isArray(variance) ? variance : (variance as { data?: VarianceRow[] })?.data ?? []
  const chartData = varianceRows.map((row) => ({
    name: (row.category ?? row.costCenter ?? 'Other') as string,
    Budgeted: row.budgeted,
    Actual: row.actual,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Budgets</h1>
          <p className="text-sm text-muted-foreground">Set spend limits and track variance by period.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} isLoading={importMutation.isPending}>
            <Upload size={16} /> Import CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Variance report</CardTitle>
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-40" />
        </CardHeader>
        <CardContent>
          {chartData.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" stroke="var(--color-text-dim)" fontSize={12} />
                  <YAxis stroke="var(--color-text-dim)" fontSize={12} />
                  <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} />
                  <Legend />
                  <Bar dataKey="Budgeted" fill="var(--color-gold)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Actual" fill="var(--color-blue)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No variance data for this period yet.</p>
          )}

          {varianceRows.length > 0 && (
            <table className="mt-6 w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2">Category</th>
                  <th className="py-2 text-right">Budgeted</th>
                  <th className="py-2 text-right">Actual</th>
                  <th className="py-2 text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {varianceRows.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="py-2">{row.category ?? row.costCenter ?? 'Other'}</td>
                    <td className="py-2 text-right">{formatCurrency(row.budgeted)}</td>
                    <td className="py-2 text-right">{formatCurrency(row.actual)}</td>
                    <td className={`py-2 text-right font-medium ${(row.actual - row.budgeted) > 0 ? 'text-destructive' : 'text-success'}`}>
                      {formatCurrency(row.variance ?? row.actual - row.budgeted)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Budget lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-4">Period</th>
                <th className="p-4 text-right">Amount</th>
                <th className="p-4 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {(Array.isArray(budgets) ? budgets : budgets?.data ?? []).map((b) => (
                <tr key={b.id} className="border-b border-border last:border-0">
                  <td className="p-4">{b.period ?? '—'}</td>
                  <td className="p-4 text-right font-semibold text-foreground">{formatCurrency(b.amount)}</td>
                  <td className="p-4 text-right">
                    <button onClick={() => removeMutation.mutate(b.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
