import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/dialog'
import { stockApi } from '@/lib/api/stock'
import { apiError } from '@/lib/api/spend'
import { formatNaira } from '@/lib/money'
import { usePermissions } from '@/lib/permissions'
import { spendKeys } from '@/components/shared/hooks'
import { MicroChip } from '@/components/shared/Popover'
import { CsvUploadDialog } from '@/components/shared/CsvUploadDialog'
import { StockDialog } from '@/components/stock/StockDialog'
import type { StockItem } from '@/types/vendors'

export default function StockPage() {
  const qc = useQueryClient()
  const { canPost } = usePermissions()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [editing, setEditing] = useState<StockItem | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleting, setDeleting] = useState<StockItem | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const { data: items = [], isLoading } = useQuery({
    queryKey: [...spendKeys.stock, 'list', debounced],
    queryFn: () => stockApi.list({ search: debounced || undefined }),
    placeholderData: (p) => p,
  })

  const remove = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await stockApi.remove(deleting.id)
      toast.success(`${deleting.name} deleted`)
      qc.invalidateQueries({ queryKey: spendKeys.stock })
      setDeleting(null)
    } catch (e) {
      toast.error(apiError(e, 'Could not delete'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Stock Expenses</h1>
          <p className="text-sm text-text-dim">Reusable line items — pick from these when adding to the queue.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => stockApi.downloadTemplate().catch((e) => toast.error(apiError(e)))}>
            <Download size={14} /> Template
          </Button>
          {canPost && (
            <>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <Upload size={14} /> Import CSV
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null)
                  setDialogOpen(true)
                }}
              >
                <Plus size={14} /> New stock item
              </Button>
            </>
          )}
        </div>
      </div>
      {!canPost && <p className="text-xs text-text-dim">Read-only — Poster role required to edit</p>}

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search stock items" className="pl-9" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="bg-secondary text-[10px] uppercase tracking-wider text-text-dim">
            <tr>
              {['Name', 'Description', 'Category', 'COA', 'Vendor', 'Unit', 'Price', 'Active', ''].map((h) => (
                <th key={h} className={h === 'Price' ? 'px-3 py-2 text-right' : 'px-3 py-2'}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-text-dim">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-text-dim">
                  {debounced ? 'No stock items match.' : 'No stock items yet.'}
                </td>
              </tr>
            )}
            {items.map((i) => (
              <tr key={i.id} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{i.name}</td>
                <td className="max-w-[16rem] truncate px-3 py-2 text-text-dim">{i.description ?? '—'}</td>
                <td className="px-3 py-2">
                  {i.payCategory ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: i.payCategory.color }} />
                      {i.payCategory.name}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2">{i.coaTag?.name ?? '—'}</td>
                <td className="px-3 py-2">{i.vendor?.name ?? '—'}</td>
                <td className="px-3 py-2">{i.unitName ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNaira(i.unitAmount)}</td>
                <td className="px-3 py-2">
                  {i.isActive ? <MicroChip className="text-green">Active</MicroChip> : <MicroChip className="text-text-dim">Off</MicroChip>}
                </td>
                <td className="px-3 py-2 text-right">
                  {canPost && (
                    <div className="flex justify-end gap-1">
                      <button
                        className="rounded p-1 text-text-dim hover:bg-accent hover:text-foreground"
                        aria-label="Edit"
                        onClick={() => {
                          setEditing(i)
                          setDialogOpen(true)
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button className="rounded p-1 text-text-dim hover:bg-red/10 hover:text-red" aria-label="Delete" onClick={() => setDeleting(i)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <StockDialog open={dialogOpen} onClose={() => setDialogOpen(false)} item={editing} />
      <ConfirmDialog
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        isLoading={busy}
        isDangerous
        title="Delete stock item?"
        description={`Delete "${deleting?.name ?? ''}"? Existing queue lines are not affected.`}
        confirmText="Delete"
      />
      <CsvUploadDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import stock items"
        description="Rows are matched by name (existing items are updated). Category, COA and vendor must match names in this workspace."
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'description', label: 'Description' },
          { key: 'category', label: 'Category' },
          { key: 'coa', label: 'COA' },
          { key: 'vendor', label: 'Vendor' },
          { key: 'unit_name', label: 'Unit' },
          { key: 'unit_price', label: 'Price' },
        ]}
        onTemplate={stockApi.downloadTemplate}
        onImport={async (csv) => {
          const r = await stockApi.importCsv(csv)
          qc.invalidateQueries({ queryKey: spendKeys.stock })
          if (r.errors.length) toast.warning(r.errors.slice(0, 5).map((e) => `Row ${e.row}: ${e.reason}`).join('\n'))
          return `${r.created.length} added · ${r.updated.length} updated${r.errors.length ? ` · ${r.errors.length} skipped` : ''}`
        }}
      />
    </div>
  )
}
