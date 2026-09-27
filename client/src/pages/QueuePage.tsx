import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { Plus, Upload, Trash2 } from 'lucide-react'
import { queueApi, vendorsApi, batchesApi } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatCurrency } from '@/lib/utils'

export default function QueuePage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [form, setForm] = useState({ vendorId: '', amount: '', description: '', category: '' })

  const { data: queue, isLoading } = useQuery({ queryKey: ['queue'], queryFn: () => queueApi.list({ limit: 100 }) })
  const { data: vendors } = useQuery({ queryKey: ['vendors', 'all'], queryFn: () => vendorsApi.list({ limit: 200 }) })

  const addMutation = useMutation({
    mutationFn: queueApi.create,
    onSuccess: () => {
      toast.success('Added to queue')
      setForm({ vendorId: '', amount: '', description: '', category: '' })
      qc.invalidateQueries({ queryKey: ['queue'] })
    },
    onError: () => toast.error('Could not add item'),
  })

  const removeMutation = useMutation({
    mutationFn: queueApi.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queue'] }),
  })

  const csvMutation = useMutation({
    mutationFn: queueApi.csvImport,
    onSuccess: () => {
      toast.success('CSV imported')
      qc.invalidateQueries({ queryKey: ['queue'] })
    },
    onError: () => toast.error('CSV import failed'),
  })

  const batchMutation = useMutation({
    mutationFn: (ids: string[]) => batchesApi.create(ids),
    onSuccess: (batch) => {
      toast.success('Batch created')
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ['queue'] })
      navigate(`/batches/${batch.id}`)
    },
    onError: () => toast.error('Could not create batch'),
  })

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => csvMutation.mutate(String(reader.result))
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payment Queue</h1>
          <p className="text-sm text-muted-foreground">Stage items, then group them into a batch to disburse.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} isLoading={csvMutation.isPending}>
            <Upload size={16} /> Import CSV
          </Button>
          <Button
            disabled={selected.size === 0}
            isLoading={batchMutation.isPending}
            onClick={() => batchMutation.mutate(Array.from(selected))}
          >
            <Plus size={16} /> Create batch ({selected.size})
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault()
              if (!form.vendorId || !form.amount) return toast.error('Vendor and amount are required')
              addMutation.mutate({
                vendorId: form.vendorId,
                amount: Number(form.amount),
                description: form.description,
                category: form.category,
              })
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
            <Input
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
            <Input
              placeholder="Category"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
            <Button type="submit" isLoading={addMutation.isPending}>
              <Plus size={16} /> Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-4 w-10"></th>
                <th className="p-4">Vendor</th>
                <th className="p-4">Description</th>
                <th className="p-4">Category</th>
                <th className="p-4 text-right">Amount</th>
                <th className="p-4 w-10"></th>
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
              {queue?.data.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                  <td className="p-4">
                    <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
                  </td>
                  <td className="p-4 font-medium text-foreground">{item.vendorName ?? '—'}</td>
                  <td className="p-4 text-muted-foreground">{item.description ?? '—'}</td>
                  <td className="p-4 text-muted-foreground">{item.category ?? '—'}</td>
                  <td className="p-4 text-right font-semibold text-foreground">{formatCurrency(item.amount)}</td>
                  <td className="p-4 text-right">
                    <button
                      onClick={() => removeMutation.mutate(item.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoading && queue?.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    Queue is empty. Add an item or import a CSV.
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
