import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { vendorsApi } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'

export default function VendorsPage() {
  const qc = useQueryClient()
  const [isOpen, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', accountNumber: '', bankCode: '', accountName: '', category: '' })

  const { data, isLoading } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list({ limit: 100 }) })
  const { data: banks } = useQuery({ queryKey: ['vendors', 'banks'], queryFn: vendorsApi.banks })

  const verifyMutation = useMutation({
    mutationFn: vendorsApi.verifyAccount,
    onSuccess: (res) => {
      setForm((f) => ({ ...f, accountName: res.accountName }))
      toast.success('Account verified')
    },
    onError: () => toast.error('Could not verify account'),
  })

  const createMutation = useMutation({
    mutationFn: vendorsApi.create,
    onSuccess: () => {
      toast.success('Vendor added')
      setOpen(false)
      setForm({ name: '', accountNumber: '', bankCode: '', accountName: '', category: '' })
      qc.invalidateQueries({ queryKey: ['vendors'] })
    },
    onError: () => toast.error('Could not add vendor'),
  })

  const removeMutation = useMutation({
    mutationFn: vendorsApi.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vendors</h1>
          <p className="text-sm text-muted-foreground">Your directory of payees with verified bank accounts.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> Add vendor
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-4">Name</th>
                <th className="p-4">Bank</th>
                <th className="p-4">Account</th>
                <th className="p-4">Category</th>
                <th className="p-4 w-10"></th>
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
              {data?.data.map((v) => (
                <tr key={v.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                  <td className="p-4 font-medium text-foreground">{v.name}</td>
                  <td className="p-4 text-muted-foreground">{v.bankName ?? '—'}</td>
                  <td className="p-4 text-muted-foreground">
                    {v.accountNumber ?? '—'} {v.accountName ? `· ${v.accountName}` : ''}
                  </td>
                  <td className="p-4 text-muted-foreground">{v.category ?? '—'}</td>
                  <td className="p-4 text-right">
                    <button
                      onClick={() => removeMutation.mutate(v.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoading && data?.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    No vendors yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Modal isOpen={isOpen} onClose={() => setOpen(false)} title="Add vendor">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!form.name) return toast.error('Vendor name is required')
            createMutation.mutate(form)
          }}
        >
          <div>
            <Label>Vendor name</Label>
            <Input className="mt-1.5" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <Label>Bank</Label>
            <Select
              className="mt-1.5"
              value={form.bankCode}
              onChange={(e) => setForm((f) => ({ ...f, bankCode: e.target.value, accountName: '' }))}
            >
              <option value="">Select bank…</option>
              {banks?.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Account number</Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                value={form.accountNumber}
                onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value, accountName: '' }))}
              />
              <Button
                type="button"
                variant="outline"
                isLoading={verifyMutation.isPending}
                disabled={!form.accountNumber || !form.bankCode}
                onClick={() => verifyMutation.mutate({ accountNumber: form.accountNumber, bankCode: form.bankCode })}
              >
                <ShieldCheck size={16} /> Verify
              </Button>
            </div>
            {form.accountName && <p className="mt-1.5 text-sm font-medium text-success">{form.accountName}</p>}
          </div>
          <div>
            <Label>Category</Label>
            <Input
              className="mt-1.5"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
          </div>
          <Button type="submit" className="w-full" isLoading={createMutation.isPending}>
            Save vendor
          </Button>
        </form>
      </Modal>
    </div>
  )
}
