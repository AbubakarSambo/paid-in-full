import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { customersApi } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function CustomersPage() {
  const qc = useQueryClient()
  const [isOpen, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '' })

  const { data, isLoading } = useQuery({ queryKey: ['customers'], queryFn: () => customersApi.list({ limit: 100 }) })

  const createMutation = useMutation({
    mutationFn: customersApi.create,
    onSuccess: () => {
      toast.success('Customer added')
      setOpen(false)
      setForm({ name: '', email: '', phone: '' })
      qc.invalidateQueries({ queryKey: ['customers'] })
    },
    onError: () => toast.error('Could not add customer'),
  })

  const removeMutation = useMutation({
    mutationFn: customersApi.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Customers</h1>
          <p className="text-sm text-muted-foreground">Manage the people and companies you invoice.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> Add customer
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-4">Name</th>
                <th className="p-4">Email</th>
                <th className="p-4">Phone</th>
                <th className="p-4 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {data?.data.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                  <td className="p-4 font-medium text-foreground">{c.name}</td>
                  <td className="p-4 text-muted-foreground">{c.email ?? '—'}</td>
                  <td className="p-4 text-muted-foreground">{c.phone ?? '—'}</td>
                  <td className="p-4 text-right">
                    <button onClick={() => removeMutation.mutate(c.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoading && data?.data.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted-foreground">
                    No customers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Modal isOpen={isOpen} onClose={() => setOpen(false)} title="Add customer">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!form.name) return toast.error('Name is required')
            createMutation.mutate(form)
          }}
        >
          <div>
            <Label>Name</Label>
            <Input className="mt-1.5" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              className="mt-1.5"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div>
            <Label>Phone</Label>
            <Input className="mt-1.5" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <Button type="submit" className="w-full" isLoading={createMutation.isPending}>
            Save customer
          </Button>
        </form>
      </Modal>
    </div>
  )
}
