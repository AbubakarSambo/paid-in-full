import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { apiError, productsApi } from '@/lib/api/invoicing'
import type { Product } from '@/types/invoicing'
import { IconBtn } from './CustomersTab'
import { CancelButton, Chip, Dialog, Empty, Field, Toggle, money, num, optStr } from './shared'

export function ProductsTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Product | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Product | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['products', 'list', search],
    queryFn: () => productsApi.list({ search: search || undefined, limit: 100 }),
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []
  const del = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => {
      toast.success('Product deleted')
      qc.invalidateQueries({ queryKey: ['products'] })
      setDeleting(null)
    },
    onError: (e) => toast.error(apiError(e)),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
          <Input className="pl-9" placeholder="Search name, SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => setEditing(null)}>
          <Plus size={14} /> New product
        </Button>
      </div>
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : rows.length === 0 ? (
        <Empty>No products yet. Products pre-fill invoice lines.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-surface2 text-[10px] uppercase tracking-wider text-text-dim">
              <tr>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-right">Unit price</th>
                <th className="px-3 py-2 text-right">VAT</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-semibold">
                      {p.name} {!p.active && <Chip>Inactive</Chip>}
                    </div>
                    {p.description && <div className="text-xs text-text-dim">{p.description}</div>}
                  </td>
                  <td className="px-3 py-2 text-text-dim">{p.sku ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(p.unitPrice)}
                    {p.unitName && <span className="text-text-dim"> / {p.unitName}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(p.taxRate)}%</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <IconBtn title="Edit" onClick={() => setEditing(p)}>
                        <Pencil size={14} />
                      </IconBtn>
                      <IconBtn title="Delete" danger onClick={() => setDeleting(p)}>
                        <Trash2 size={14} />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ProductDialog product={editing} onClose={() => setEditing(undefined)} />
      <Dialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? ''}?`}
        footer={
          <>
            <CancelButton onClick={() => setDeleting(null)} />
            <Button size="sm" variant="destructive" isLoading={del.isPending} onClick={() => deleting && del.mutate(deleting.id)}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-dim">Existing invoice lines keep their description and price. You can mark it inactive instead.</p>
      </Dialog>
    </div>
  )
}

function ProductDialog({ product, onClose }: { product: Product | null | undefined; onClose: () => void }) {
  const qc = useQueryClient()
  const open = product !== undefined
  const [f, setF] = useState({ name: '', description: '', sku: '', unitName: '', unitPrice: '', taxRate: '7.5', active: true })
  useEffect(() => {
    if (!open) return
    setF(
      product
        ? {
            name: product.name,
            description: product.description ?? '',
            sku: product.sku ?? '',
            unitName: product.unitName ?? '',
            unitPrice: String(num(product.unitPrice)),
            taxRate: String(num(product.taxRate)),
            active: product.active,
          }
        : { name: '', description: '', sku: '', unitName: '', unitPrice: '', taxRate: '7.5', active: true },
    )
  }, [open, product])
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        description: optStr(f.description),
        sku: optStr(f.sku),
        unitName: optStr(f.unitName),
        unitPrice: Number(f.unitPrice),
        taxRate: Number(f.taxRate) || 0,
        active: f.active,
      }
      return product ? productsApi.update(product.id, body) : productsApi.create(body)
    },
    onSuccess: () => {
      toast.success('Product saved')
      qc.invalidateQueries({ queryKey: ['products'] })
      onClose()
    },
    onError: (e) => toast.error(apiError(e)),
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const rate = Number(f.taxRate)
  const valid = !!f.name.trim() && f.unitPrice !== '' && Number(f.unitPrice) >= 0 && rate >= 0 && rate <= 100
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={product ? 'Edit product' : 'New product'}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <Button size="sm" disabled={!valid} isLoading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <Input value={f.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea rows={2} value={f.description} onChange={set('description')} />
        </Field>
        <Field label="SKU">
          <Input value={f.sku} onChange={set('sku')} />
        </Field>
        <Field label="Unit (e.g. hour, piece)">
          <Input value={f.unitName} onChange={set('unitName')} />
        </Field>
        <Field label="Unit price (₦)">
          <Input type="number" min={0} value={f.unitPrice} onChange={set('unitPrice')} />
        </Field>
        <Field label="VAT %">
          <Input type="number" min={0} max={100} value={f.taxRate} onChange={set('taxRate')} />
        </Field>
        <div className="sm:col-span-2">
          <Toggle checked={f.active} onChange={(v) => setF((x) => ({ ...x, active: v }))} label="Active (shown in the invoice editor)" />
        </div>
      </div>
    </Dialog>
  )
}
