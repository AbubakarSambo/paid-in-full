import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, FileDown, FileText, LayoutGrid, List, Plus, Search, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/dialog'
import { vendorsApi } from '@/lib/api/vendors'
import { apiError } from '@/lib/api/spend'
import { usePermissions } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { spendKeys } from '@/components/shared/hooks'
import { MicroChip } from '@/components/shared/Popover'
import { CsvUploadDialog } from '@/components/shared/CsvUploadDialog'
import { VendorDialog } from '@/components/vendors/VendorDialog'
import { VendorCard, VerifiedBadge } from '@/components/vendors/VendorCard'
import type { Vendor } from '@/types/vendors'

const VIEW_KEY = 'pif.vendors.view'
const PAGE_SIZE = 60
const TOP_TAGS = 8

function readView(): 'grid' | 'list' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

export default function VendorsPage() {
  const qc = useQueryClient()
  const { canPost, isAdmin } = usePermissions()
  const [view, setView] = useState<'grid' | 'list'>(readView)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [showAllTags, setShowAllTags] = useState(false)
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Vendor | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState<Vendor | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => setPage(1), [debounced, tag])
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {
      /* ignore */
    }
  }, [view])

  const { data, isLoading } = useQuery({
    queryKey: [...spendKeys.vendors, 'list', debounced, tag, page],
    queryFn: () => vendorsApi.list({ search: debounced || undefined, tag: tag ?? undefined, page, limit: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  })
  const { data: tags = [] } = useQuery({ queryKey: spendKeys.vendorTags, queryFn: vendorsApi.tags })

  const vendors = data?.data ?? []
  const shownTags = showAllTags ? tags : tags.slice(0, TOP_TAGS)
  const filters = { search: debounced || undefined, tag: tag ?? undefined }

  const run = (fn: () => Promise<void>) => () => fn().catch((e) => toast.error(apiError(e, 'Download failed')))
  const openNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const r = await vendorsApi.remove(deleting.id)
      toast.success(r.deactivated ? `${deleting.name} has payment history, so it was deactivated` : `${deleting.name} deleted`)
      qc.invalidateQueries({ queryKey: spendKeys.vendors })
      setDeleting(null)
    } catch (e) {
      toast.error(apiError(e, 'Could not delete vendor'))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Vendor Register</h1>
          <p className="text-sm text-text-dim tabular-nums">
            {data ? `${data.meta.total} of ${data.totalVendors} vendors` : 'Loading…'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            {(['grid', 'list'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn('rounded-md px-2 py-1.5', view === v ? 'bg-gold/15 text-gold' : 'text-text-dim')}
                aria-label={v === 'grid' ? 'Grid view' : 'List view'}
              >
                {v === 'grid' ? <LayoutGrid size={14} /> : <List size={14} />}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={run(vendorsApi.downloadTemplate)}>
            <Download size={14} /> CSV Template
          </Button>
          <Button size="sm" variant="outline" onClick={run(() => vendorsApi.exportCsv(filters))}>
            <FileDown size={14} /> Export CSV
          </Button>
          <Button size="sm" variant="outline" onClick={run(() => vendorsApi.exportPdf(filters))}>
            <FileText size={14} /> Export PDF
          </Button>
          {canPost && (
            <>
              <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
                <Upload size={14} /> Bulk Upload CSV
              </Button>
              <Button size="sm" onClick={openNew}>
                <Plus size={14} /> Register Vendor
              </Button>
            </>
          )}
        </div>
      </div>
      {!canPost && <p className="text-xs text-text-dim">Read-only — Poster role required to edit</p>}

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors, bank, account no. or tag" className="pl-9" />
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <TagChip active={!tag} onClick={() => setTag(null)}>
            All
          </TagChip>
          {shownTags.map((t) => (
            <TagChip key={t.tag} active={tag === t.tag} onClick={() => setTag(tag === t.tag ? null : t.tag)}>
              {t.tag} <span className="opacity-60">{t.count}</span>
            </TagChip>
          ))}
          {tags.length > TOP_TAGS && (
            <button onClick={() => setShowAllTags((s) => !s)} className="px-2 text-xs text-gold hover:underline">
              {showAllTags ? 'Fewer tags' : `+${tags.length - TOP_TAGS} more tags`}
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-text-dim">Loading vendors…</p>
      ) : vendors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-dim">
          {debounced || tag ? 'No vendors match your filters.' : 'No vendors yet — register your first vendor.'}
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {vendors.map((v) => (
            <VendorCard
              key={v.id}
              vendor={v}
              onEdit={() => {
                setEditing(v)
                setDialogOpen(true)
              }}
              onDelete={isAdmin ? () => setDeleting(v) : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="bg-secondary text-[10px] uppercase tracking-wider text-text-dim">
              <tr>
                {['Name', 'Bank', 'Account #', 'Contact', 'Phone', 'TIN', 'Status', 'Tags', ''].map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr
                  key={v.id}
                  className="cursor-pointer border-t border-border hover:bg-accent/50"
                  onClick={() => {
                    setEditing(v)
                    setDialogOpen(true)
                  }}
                >
                  <td className="px-3 py-2 font-medium">{v.name}</td>
                  <td className="px-3 py-2">{v.bankName ?? <span className="text-orange">—</span>}</td>
                  <td className="px-3 py-2 tabular-nums">{v.bankAccountNumber ?? '—'}</td>
                  <td className="px-3 py-2">{v.contactPerson ?? v.verifiedAccountName ?? '—'}</td>
                  <td className="px-3 py-2">{v.phone ?? '—'}</td>
                  <td className="px-3 py-2">{v.tin ?? <span className="text-purple">No TIN</span>}</td>
                  <td className="px-3 py-2">
                    <VerifiedBadge vendor={v} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {v.tags.map((t) => (
                        <MicroChip key={t} className="text-text-dim">
                          {t}
                        </MicroChip>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isAdmin && (
                      <button
                        className="text-xs text-red hover:underline"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleting(v)
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="tabular-nums text-text-dim">
            Page {page} of {data.meta.totalPages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}

      <VendorDialog open={dialogOpen} onClose={() => setDialogOpen(false)} vendor={editing} readOnly={!canPost} />
      <ConfirmDialog
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        isLoading={deleteBusy}
        isDangerous
        title="Delete vendor?"
        description={`Delete ${deleting?.name ?? ''}? Vendors with payment history are deactivated instead, so past records stay intact.`}
        confirmText="Delete"
      />
      <CsvUploadDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk Upload Vendors"
        description="Every row is verified with the bank. Only rows where the typed name matches the bank's name are imported."
        columns={[
          { key: 'name', label: 'Vendor (typed)' },
          { key: 'bank', label: 'Bank' },
          { key: 'account', label: 'Account' },
          { key: 'contact', label: 'Contact' },
          { key: 'phone', label: 'Phone' },
          { key: 'bankResult', label: 'Bank Result' },
        ]}
        onTemplate={vendorsApi.downloadTemplate}
        onPreview={async (csv) => {
          const r = await vendorsApi.bulkPreview(csv)
          return r.rows.map((row) => ({
            status: row.status,
            importable: row.importable,
            notes: row.reason,
            values: {
              name: row.name,
              bank: row.bankName ?? row.bankInput,
              account: row.accountNumber,
              contact: row.contactName ?? '',
              phone: row.phone ?? '',
              bankResult: row.bankAccountName ?? '—',
            },
          }))
        }}
        onImport={async (csv) => {
          const r = await vendorsApi.bulkCommit(csv)
          qc.invalidateQueries({ queryKey: spendKeys.vendors })
          const parts = [`${r.created.length} vendor${r.created.length === 1 ? '' : 's'} imported`]
          if (r.skipped.length) parts.push(`${r.skipped.length} skipped`)
          if (r.failed.length) parts.push(`${r.failed.length} failed`)
          return parts.join(' · ')
        }}
      />
    </div>
  )
}

function TagChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium',
        active ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-dim hover:border-gold/50',
      )}
    >
      {children}
    </button>
  )
}
