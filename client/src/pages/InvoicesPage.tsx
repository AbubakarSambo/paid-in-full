import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Download, Send } from 'lucide-react'
import { invoicesApi, customersApi } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatDate, downloadBlob } from '@/lib/utils'

export default function InvoicesPage() {
  const qc = useQueryClient()
  const [isOpen, setOpen] = useState(false)
  const [form, setForm] = useState({ customerId: '', total: '' })

  const { data, isLoading } = useQuery({ queryKey: ['invoices'], queryFn: () => invoicesApi.list({ limit: 100 }) })
  const { data: customers } = useQuery({ queryKey: ['customers', 'all'], queryFn: () => customersApi.list({ limit: 200 }) })

  const createMutation = useMutation({
    mutationFn: invoicesApi.create,
    onSuccess: () => {
      toast.success('Invoice created')
      setOpen(false)
      setForm({ customerId: '', total: '' })
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
    onError: () => toast.error('Could not create invoice'),
  })

  const sendMutation = useMutation({
    mutationFn: invoicesApi.send,
    onSuccess: () => toast.success('Invoice sent'),
    onError: () => toast.error('Could not send invoice'),
  })

  async function handlePdf(id: string) {
    try {
      const blob = await invoicesApi.pdf(id)
      downloadBlob(blob as Blob, `invoice-${id}.pdf`)
    } catch {
      toast.error('Could not download PDF')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Invoices</h1>
          <p className="text-sm text-muted-foreground">Bill customers and track payments received.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> New invoice
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-4">Customer</th>
                <th className="p-4">Date</th>
                <th className="p-4 text-right">Total</th>
                <th className="p-4 text-right">Paid</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {data?.data.map((inv) => (
                <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                  <td className="p-4 font-medium text-foreground">{inv.customerName ?? '—'}</td>
                  <td className="p-4 text-muted-foreground">{inv.createdAt ? formatDate(inv.createdAt) : '—'}</td>
                  <td className="p-4 text-right font-semibold text-foreground">{formatCurrency(inv.total ?? 0)}</td>
                  <td className="p-4 text-right text-muted-foreground">{formatCurrency(inv.amountPaid ?? 0)}</td>
                  <td className="p-4">
                    <Badge variant={inv.status === 'PAID' ? 'success' : inv.status === 'OVERDUE' ? 'destructive' : 'outline'}>
                      {inv.status ?? 'DRAFT'}
                    </Badge>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => handlePdf(inv.id)} className="text-muted-foreground hover:text-gold" aria-label="Download PDF">
                        <Download size={16} />
                      </button>
                      <button onClick={() => sendMutation.mutate(inv.id)} className="text-muted-foreground hover:text-gold" aria-label="Send">
                        <Send size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && data?.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    No invoices yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Modal isOpen={isOpen} onClose={() => setOpen(false)} title="New invoice">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!form.customerId || !form.total) return toast.error('Customer and total are required')
            createMutation.mutate({ customerId: form.customerId, total: Number(form.total) })
          }}
        >
          <Select value={form.customerId} onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}>
            <option value="">Select customer…</option>
            {customers?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            placeholder="Total amount"
            value={form.total}
            onChange={(e) => setForm((f) => ({ ...f, total: e.target.value }))}
          />
          <Button type="submit" className="w-full" isLoading={createMutation.isPending}>
            Create invoice
          </Button>
        </form>
      </Modal>
    </div>
  )
}
