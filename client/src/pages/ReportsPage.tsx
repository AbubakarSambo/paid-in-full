import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, FileText } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { reportsApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { downloadBlob, formatCurrency } from '@/lib/utils'

function firstOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function ReportsPage() {
  const [startDate, setStartDate] = useState(firstOfMonth())
  const [endDate, setEndDate] = useState(today())
  const year = new Date().getFullYear()

  const params = { startDate, endDate }

  const { data: byCategory } = useQuery({
    queryKey: ['reports', 'category', params],
    queryFn: () => reportsApi.spendByCategory(params),
  })
  const { data: byVendor } = useQuery({
    queryKey: ['reports', 'vendor', params],
    queryFn: () => reportsApi.spendByVendor(params),
  })
  const { data: monthly } = useQuery({
    queryKey: ['reports', 'monthly', year],
    queryFn: () => reportsApi.monthlyGrid(year),
  })

  async function handleExport(kind: 'csv' | 'pdf') {
    try {
      const blob = kind === 'csv' ? await reportsApi.exportCsv(params) : await reportsApi.exportPdf(params)
      downloadBlob(blob as Blob, `report-${startDate}-to-${endDate}.${kind}`)
    } catch {
      toast.error(`Could not export ${kind.toUpperCase()}`)
    }
  }

  const categoryData = (Array.isArray(byCategory) ? byCategory : (byCategory as { data?: unknown[] })?.data ?? []) as Array<{
    category?: string
    total: number
  }>
  const vendorData = (Array.isArray(byVendor) ? byVendor : (byVendor as { data?: unknown[] })?.data ?? []) as Array<{
    vendorName?: string
    total: number
  }>
  const monthlyData = (Array.isArray(monthly) ? monthly : (monthly as { data?: unknown[] })?.data ?? []) as Array<{
    month?: string
    total: number
  }>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          <p className="text-sm text-muted-foreground">Spend analysis across categories, vendors, and time.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
          <Button variant="outline" onClick={() => handleExport('csv')}>
            <Download size={16} /> CSV
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')}>
            <FileText size={16} /> PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spend by category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="category" stroke="var(--color-text-dim)" fontSize={12} />
                  <YAxis stroke="var(--color-text-dim)" fontSize={12} />
                  <Tooltip
                    formatter={(v) => formatCurrency(Number(v))}
                    contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                  />
                  <Bar dataKey="total" fill="var(--color-gold)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spend by vendor</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={vendorData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="vendorName" stroke="var(--color-text-dim)" fontSize={12} />
                  <YAxis stroke="var(--color-text-dim)" fontSize={12} />
                  <Tooltip
                    formatter={(v) => formatCurrency(Number(v))}
                    contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                  />
                  <Bar dataKey="total" fill="var(--color-blue)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly trend ({year})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" stroke="var(--color-text-dim)" fontSize={12} />
                <YAxis stroke="var(--color-text-dim)" fontSize={12} />
                <Tooltip
                  formatter={(v) => formatCurrency(Number(v))}
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                />
                <Line type="monotone" dataKey="total" stroke="var(--color-gold)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
