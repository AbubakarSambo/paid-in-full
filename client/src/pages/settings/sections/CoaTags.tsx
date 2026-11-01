import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Download, Plus, Sparkles, Upload, Wand2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/ui/dialog'
import { apiError, apiStatus, coaTagsApi } from '@/lib/api/spend'
import { usePermissions } from '@/lib/permissions'
import { spendKeys } from '@/components/shared/hooks'
import { CsvUploadDialog, parseCsv } from '@/components/shared/CsvUploadDialog'
import { AdminOnlyNote, SettingsSection } from '@/components/shared/SettingsSection'
import type { CoaTag, PayCategory } from '@/types/spend'

export default function CoaTags() {
  const qc = useQueryClient()
  const { isAdmin } = usePermissions()
  const { data, isLoading } = useQuery({ queryKey: spendKeys.coaByCategory, queryFn: coaTagsApi.byCategory })
  const [industry, setIndustry] = useState('')
  const [confirmReplace, setConfirmReplace] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (data) setIndustry(data.industry ?? '')
  }, [data])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: spendKeys.coaTags })
    qc.invalidateQueries({ queryKey: spendKeys.payCategories })
  }

  const applyDefaults = async (replace: boolean) => {
    setApplying(true)
    try {
      await coaTagsApi.applyDefaults({ industry: industry.trim() || undefined, confirmReplace: replace })
      toast.success('Default COA set up')
      setConfirmReplace(null)
      refresh()
    } catch (e) {
      if (apiStatus(e) === 409 && !replace) setConfirmReplace(apiError(e))
      else toast.error(apiError(e))
    } finally {
      setApplying(false)
    }
  }

  return (
    <SettingsSection id="coa-tags" title="COA Tags by Payment Category" description="Chart-of-accounts tags offered under each payment category.">
      {!isAdmin && <AdminOnlyNote />}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-secondary/40 p-3">
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <Label>Industry</Label>
          <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Hospitality, Clinic/Pharmacy, Logistics" disabled={!isAdmin} />
          <p className="text-[11px] text-text-dim">Used to tailor AI suggestions and the default setup.</p>
        </div>
        {isAdmin && (
          <Button size="sm" className="h-11" onClick={() => applyDefaults(false)} isLoading={applying}>
            <Wand2 size={14} /> One-click default setup
          </Button>
        )}
        <p className="w-full text-[11px] text-text-dim">Creates 3 categories with 6 COS, 10 Opex and 6 Asset tags, tailored to the industry.</p>
      </div>
      {isLoading && <p className="text-sm text-text-dim">Loading…</p>}
      <div className="space-y-3">
        {data?.categories.map((c) => (
          <CategoryTags key={c.id} cat={c} tags={c.coaTags} isAdmin={isAdmin} industry={industry} onChanged={refresh} />
        ))}
      </div>
      <ConfirmDialog
        isOpen={!!confirmReplace}
        onClose={() => setConfirmReplace(null)}
        onConfirm={() => applyDefaults(true)}
        isLoading={applying}
        isDangerous
        title="Replace existing COA tags?"
        description={`${confirmReplace ?? ''} Tags in use on existing records are kept but turned off.`}
        confirmText="Replace with defaults"
      />
    </SettingsSection>
  )
}

function CategoryTags({
  cat,
  tags,
  isAdmin,
  industry,
  onChanged,
}: {
  cat: PayCategory
  tags: CoaTag[]
  isAdmin: boolean
  industry: string
  onChanged: () => void
}) {
  const [draft, setDraft] = useState('')
  const [suggestions, setSuggestions] = useState<string[] | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)

  const add = async (name: string) => {
    const n = name.trim()
    if (!n) return false
    try {
      await coaTagsApi.create(cat.id, n)
      onChanged()
      return true
    } catch (e) {
      toast.error(apiError(e))
      return false
    }
  }
  const remove = async (t: CoaTag) => {
    if (!confirm(`Remove "${t.name}" from ${cat.name}?`)) return
    try {
      await coaTagsApi.remove(t.id)
      onChanged()
    } catch (e) {
      if (apiStatus(e) === 409 && confirm(`${apiError(e)}\n\nTurn it off now?`)) {
        await coaTagsApi.update(t.id, { isActive: false }).catch((err) => toast.error(apiError(err)))
        onChanged()
      } else if (apiStatus(e) !== 409) toast.error(apiError(e))
    }
  }
  const suggest = async () => {
    setSuggesting(true)
    try {
      const r = await coaTagsApi.suggest(cat.id, industry)
      setSuggestions(r.suggestions)
      if (!r.suggestions.length) toast.info('No new suggestions for this category')
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setSuggesting(false)
    }
  }

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: cat.color }} />
        <span className="font-semibold">{cat.name}</span>
        <span className="text-[11px] text-text-dim">{tags.length} tags</span>
        {isAdmin && (
          <span className="ml-auto flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" className="h-8" onClick={suggest} isLoading={suggesting}>
              {!suggesting && <Sparkles size={13} />} AI Suggest
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => coaTagsApi.downloadTemplate(cat.id, cat.name).catch((e) => toast.error(apiError(e)))}>
              <Download size={13} /> Template
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setUploadOpen(true)}>
              <Upload size={13} /> Upload CSV
            </Button>
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/50 px-2 py-1 text-xs">
            {t.name}
            {isAdmin && (
              <button className="text-text-dim hover:text-red" onClick={() => remove(t)} aria-label={`Remove ${t.name}`}>
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {tags.length === 0 && <span className="text-xs text-text-dim">No COA tags yet</span>}
      </div>
      {suggestions && suggestions.length > 0 && (
        <div className="mt-3 rounded-lg border border-blue/30 bg-blue/5 p-2">
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-blue">
            Suggestions
            <button className="text-text-dim hover:text-foreground" onClick={() => setSuggestions(null)} aria-label="Dismiss">
              <X size={12} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-lg border border-blue/30 px-2 py-1 text-xs">
                {s}
                <button
                  className="text-green"
                  aria-label={`Accept ${s}`}
                  onClick={async () => (await add(s)) && setSuggestions((list) => list?.filter((x) => x !== s) ?? null)}
                >
                  <Check size={12} />
                </button>
                <button className="text-text-dim hover:text-red" aria-label={`Reject ${s}`} onClick={() => setSuggestions((list) => list?.filter((x) => x !== s) ?? null)}>
                  <X size={12} />
                </button>
              </span>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={async () => {
                for (const s of suggestions) await add(s)
                setSuggestions(null)
              }}
            >
              Accept all
            </Button>
          </div>
        </div>
      )}
      {isAdmin && (
        <div className="mt-2 flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Add a COA tag to ${cat.name}`}
            className="h-8 max-w-xs text-xs"
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && (await add(draft))) setDraft('')
            }}
          />
          <Button size="sm" variant="outline" className="h-8" disabled={!draft.trim()} onClick={async () => (await add(draft)) && setDraft('')}>
            <Plus size={12} /> Add
          </Button>
        </div>
      )}
      <CsvUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title={`Upload COA tags — ${cat.name}`}
        description="One tag per row in a coa_tag column. Existing tags are skipped."
        columns={[{ key: 'tag', label: 'COA tag' }]}
        onTemplate={() => coaTagsApi.downloadTemplate(cat.id, cat.name)}
        onPreview={async (csv) => {
          const existing = new Set(tags.map((t) => t.name.toLowerCase()))
          const firstLine = (csv.split(/\r?\n/)[0] ?? '').trim().toLowerCase()
          const hasHeader = ['coa_tag', 'coa tag', 'name', 'tag', 'coa'].includes(firstLine.split(',')[0].replace(/"/g, ''))
          const rows = parseCsv(hasHeader ? csv : `coa_tag\n${csv}`)
          return rows.map((r) => {
            const tag = r.coa_tag ?? r['coa tag'] ?? r.name ?? r.tag ?? r.coa ?? Object.values(r)[0] ?? ''
            const dup = existing.has(tag.toLowerCase())
            return { status: !tag ? 'empty' : dup ? 'exists' : 'ready', importable: !!tag && !dup, notes: dup ? 'Already in this category' : '', values: { tag } }
          })
        }}
        onImport={async (csv) => {
          const r = await coaTagsApi.importCsv(cat.id, csv)
          onChanged()
          return `${r.created.length} added · ${r.reactivated.length} turned back on · ${r.skipped.length} skipped`
        }}
      />
    </div>
  )
}
