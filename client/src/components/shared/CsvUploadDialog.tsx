import { useEffect, useState } from 'react'
import { Download, FileUp } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { apiError } from '@/lib/api/spend'
import { cn } from '@/lib/utils'

export interface CsvPreviewRow {
  /** e.g. "ready", "error", "mismatch". Rows with importable=false are shown dimmed. */
  status: string
  importable: boolean
  notes?: string
  values: Record<string, string>
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). First row = header (lower-cased keys). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  const clean = rows.filter((r) => r.some((c) => c.trim()))
  if (!clean.length) return []
  const header = clean[0].map((h) => h.trim().toLowerCase())
  return clean.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}

/**
 * Generic CSV upload: template download + choose file + preview table (Status / columns / Notes) + Import.
 * Props: open, onClose, title, description?, columns ({key,label}[]), onTemplate?() (download), onPreview?(csv) → rows
 * (default: client-side parse, every row importable), onImport(csv) → summary message (toast) or void, importLabel?.
 */
export function CsvUploadDialog({
  open,
  onClose,
  title,
  description,
  columns,
  onTemplate,
  onPreview,
  onImport,
  importLabel = 'Import',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  columns: { key: string; label: string }[]
  onTemplate?: () => void | Promise<void>
  onPreview?: (csv: string) => Promise<CsvPreviewRow[]>
  onImport: (csv: string) => Promise<string | void>
  importLabel?: string
}) {
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<CsvPreviewRow[] | null>(null)
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null)

  useEffect(() => {
    if (!open) {
      setCsv('')
      setFileName('')
      setRows(null)
    }
  }, [open])

  const choose = async (file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    setCsv(text)
    setFileName(file.name)
    setBusy('preview')
    try {
      const r = onPreview
        ? await onPreview(text)
        : parseCsv(text).map((values) => ({ status: 'ready', importable: true, values }))
      setRows(r)
    } catch (e) {
      toast.error(apiError(e, 'Could not read the CSV'))
      setRows(null)
    } finally {
      setBusy(null)
    }
  }

  const importable = rows?.filter((r) => r.importable).length ?? 0
  const doImport = async () => {
    setBusy('import')
    try {
      const msg = await onImport(csv)
      toast.success(msg || 'Import complete')
      onClose()
    } catch (e) {
      toast.error(apiError(e, 'Import failed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal isOpen={open} onClose={onClose} title={title} description={description} className="max-w-4xl">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {onTemplate && (
            <Button type="button" size="sm" variant="outline" onClick={() => void Promise.resolve(onTemplate()).catch((e) => toast.error(apiError(e)))}>
              <Download size={14} /> Download Template
            </Button>
          )}
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-gold px-4 text-xs font-semibold text-primary-foreground hover:brightness-110">
            <FileUp size={14} /> {fileName ? 'Choose another file' : 'Choose CSV file'}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void choose(e.target.files?.[0])} />
          </label>
          {fileName && <span className="self-center text-xs text-text-dim">{fileName}</span>}
        </div>
        {busy === 'preview' && <p className="text-sm text-text-dim">Checking rows…</p>}
        {rows && (
          <>
            <p className="text-xs text-text-dim">
              {rows.length} row{rows.length === 1 ? '' : 's'} · <span className="text-green">{importable} ready</span>
              {rows.length - importable > 0 && <span className="text-orange"> · {rows.length - importable} will be skipped</span>}
            </p>
            <div className="max-h-[45vh] overflow-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-secondary text-[10px] uppercase tracking-wider text-text-dim">
                  <tr>
                    <th className="px-2 py-2">Status</th>
                    {columns.map((c) => (
                      <th key={c.key} className="px-2 py-2">
                        {c.label}
                      </th>
                    ))}
                    <th className="px-2 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={cn('border-t border-border', !r.importable && 'opacity-60')}>
                      <td className="px-2 py-1.5">
                        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', r.importable ? 'bg-green/15 text-green' : 'bg-orange/15 text-orange')}>
                          {r.status}
                        </span>
                      </td>
                      {columns.map((c) => (
                        <td key={c.key} className="max-w-[12rem] truncate px-2 py-1.5">
                          {r.values[c.key] ?? ''}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-text-dim">{r.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={busy === 'import'}>
            Cancel
          </Button>
          <Button onClick={doImport} disabled={!rows || importable === 0} isLoading={busy === 'import'}>
            {importLabel}
            {rows ? ` (${importable})` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
