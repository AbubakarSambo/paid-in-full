import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, X, Send, Plus } from 'lucide-react'
import { requisitionsApi, vendorsApi } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency, formatDate } from '@/lib/utils'

export default function RequisitionsPage() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isCreateOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ vendorId: '', amount: '', description: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['requisitions'],
    queryFn: () => requisitionsApi.list({ limit: 100 }),
  })
  const { data: vendors } = useQuery({ queryKey: ['vendors', 'all'], queryFn: () => vendorsApi.list({ limit: 200 }) })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['requisitions'] })

  const createMutation = useMutation({
    mutationFn: requisitionsApi.create,
    onSuccess: () => {
      toast.success('Requisition submitted')
      setCreateOpen(false)
      setForm({ vendorId: '', amount: '', description: '' })
      invalidate()
    },
    onError: () => toast.error('Could not submit requisition'),
  })
  const approveMutation = useMutation({ mutationFn: requisitionsApi.approve, onSuccess: invalidate })
  const rejectMutation = useMutation({ mutationFn: (id: string) => requisitionsApi.reject(id), onSuccess: invalidate })
  const pushMutation = useMutation({
    mutationFn: () => requisitionsApi.pushToQueue(Array.from(selected)),
    onSuccess: () => {
      toast.success('Pushed to queue')
      setSelected(new Set())
      invalidate()
    },
    onError: () => toast.error('Could not push to queue'),
  })

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Requisitions</h1>
          <p className="text-sm text-muted-foreground">Approve requests before they hit the payment queue.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> New requisition
          </Button>
          <Button disabled={selected.size === 0} isLoading={pushMutation.isPending} onClick={() => pushMutation.mutate()}>
            <Send size={16} /> Push to queue ({selected.size})
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-4 w-10"></th>
                <th className="p-4">Vendor</th>
                <th className="p-4">Description</th>
                <th className="p-4 text-right">Amount</th>
                <th className="p-4">Status</th>
                <th className="p-4">Date</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {data?.data.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                  <td className="p-4">
                    {r.status === 'APPROVED' && (
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    )}
                  </td>
                  <td className="p-4 font-medium text-foreground">{r.vendorName ?? '—'}</td>
                  <td className="p-4 text-muted-foreground">{r.description ?? '—'}</td>
                  <td className="p-4 text-right font-semibold text-foreground">{formatCurrency(r.amount)}</td>
                  <td className="p-4">
                    <Badge variant={r.status === 'APPROVED' ? 'success' : r.status === 'REJECTED' ? 'destructive' : 'outline'}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="p-4 text-muted-foreground">{r.createdAt ? formatDate(r.createdAt) : '—'}</td>
                  <td className="p-4 text-right">
                    {r.status === 'PENDING' && (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => approveMutation.mutate(r.id)}
                          className="text-success hover:opacity-80"
                          aria-label="Approve"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          onClick={() => rejectMutation.mutate(r.id)}
                          className="text-destructive hover:opacity-80"
                          aria-label="Reject"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!isLoading && data?.data.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    No requisitions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Modal isOpen={isCreateOpen} onClose={() => setCreateOpen(false)} title="New requisition">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!form.vendorId || !form.amount) return toast.error('Vendor and amount are required')
            createMutation.mutate({ vendorId: form.vendorId, amount: Number(form.amount), description: form.description })
          }}
        >
          <Select value={form.vendorId} onChange={(e) => setForm((f) => ({ ...f, vendorId: e.target.value }))}>
            <option value="">Select vendor…</option>
            {vendors?.data.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            placeholder="Amount"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <Textarea
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <Button type="submit" className="w-full" isLoading={createMutation.isPending}>
            Submit requisition
          </Button>
        </form>
      </Modal>
    </div>
  )
}
