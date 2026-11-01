import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, FileUp } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatNaira } from '@/lib/money'
import { apiErrorMessage, queueApi, queueKeys } from '@/lib/api/queue'
import type { CsvPreviewResponse } from '@/types/queue'
import { Chip, ModalFooter } from './common'
import { readFileText, saveBlob } from './helpers'

/** Bulk CSV upload: Download Template / Choose CSV → preview (Status + Notes per row) → Import. */
export function QueueCsvDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<CsvPreviewResponse | null>(null)
  const [includeDups, setIncludeDups] = useState(false)

  useEffect(() => {
    if (!open) return
    setCsv('')
    setFileName('')
    setPreview(null)
    setIncludeDups(false)
  }, [open])

  const runPreview = useMutation({
    mutationFn: (text: string) => queueApi.csvPreview(text),
    onSuccess: setPreview,
    onError: (e) => toast.error(apiErrorMessage(e)),
  })
  const runImport = useMutation({
    mutationFn: () => queueApi.csvImport(csv, includeDups),
    onSuccess: (res) => {
      toast.success(`${res.imported} item${res.imported === 1 ? '' : 's'} imported · ${formatNaira(res.total)}${res.skipped ? ` · ${res.skipped} skipped` : ''}`)
      qc.invalidateQueries({ queryKey: queueKeys.all })
      onClose()
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })

  const importable = preview ? preview.summary.ok + (includeDups ? preview.summary.duplicates : 0) : 0

  return (
    <Modal isOpen={open} onClose={onClose} title="Upload CSV" description="Category and vendor must match exact names in this workspace." className="max-w-5xl">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              saveBlob(await queueApi.csvTemplate(), 'queue-template.csv')
            } catch (e) {
              toast.error(apiErrorMessage(e))
            }
          }}
        >
          <Download size={14} /> Download Template
        </Button>
        <Button size="sm" variant="outline" isLoading={runPreview.isPending} onClick={() => fileRef.current?.click()}>
          <FileUp size={14} /> Choose CSV file
        </Button>
        {fileName && <span className="text-xs text-text-dim">{fileName}</span>}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            const text = await readFileText(f)
            setCsv(text)
            setFileName(f.name)
            runPreview.mutate(text)
          }}
        />
      </div>

      {preview && (
        <>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Chip tone="green">{preview.summary.ok} ready</Chip>
            {preview.summary.duplicates > 0 && <Chip tone="orange">{preview.summary.duplicates} possible duplicates</Chip>}
            {preview.summary.errors > 0 && <Chip tone="red">{preview.summary.errors} errors</Chip>}
            <span className="text-text-dim">Importable total {formatNaira(preview.summary.importableTotal)}</span>
          </div>
          <div className="mt-3 max-h-[50vh] overflow-auto rounded-xl border border-border">
            <table className="w-full min-w-[800px] text-xs">
              <thead className="sticky top-0 bg-surface2 text-[10px] uppercase tracking-wider text-text-dim">
                <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left">
                  <th>Status</th>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>COA</th>
                  <th className="!text-right">Units</th>
                  <th className="!text-right">Amt</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.rows.map((r) => (
                  <tr key={r.row} className={cn('[&>td]:px-2 [&>td]:py-1.5', r.status === 'error' && 'bg-red/5')}>
                    <td>
                      <Chip tone={r.status === 'ok' ? 'green' : r.status === 'duplicate' ? 'orange' : 'red'}>{r.status}</Chip>
                    </td>
                    <td className="whitespace-nowrap">{r.date ?? ''}</td>
                    <td>{r.vendor}</td>
                    <td className="max-w-[220px] truncate">{r.description}</td>
                    <td>{r.category}</td>
                    <td>{r.coa}</td>
                    <td className="text-right tabular-nums">{r.units ?? ''}</td>
                    <td className="text-right tabular-nums">{r.amount !== null ? formatNaira(r.amount) : ''}</td>
                    <td className="text-text-dim">{r.notes.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.summary.duplicates > 0 && (
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" className="accent-[var(--gold)]" checked={includeDups} onChange={(e) => setIncludeDups(e.target.checked)} />
              Import possible duplicates too
            </label>
          )}
        </>
      )}
      <ModalFooter>
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={!importable} isLoading={runImport.isPending} onClick={() => runImport.mutate()}>
          Import {importable || ''}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
