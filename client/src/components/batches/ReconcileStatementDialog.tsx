import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { apiErrorMessage, batchKeys, statementApi } from '@/lib/api/batches'
import type { StatementConfirmResult, StatementPreview, StatementRow } from '@/types/batches'
import { MicroLabel, Sheet, fmtDate, naira } from './shared'

type Choice = { checked: boolean; candidateId: string | null }

const confidenceCls = (c: number) => (c >= 80 ? 'bg-green/15 text-green' : c >= 60 ? 'bg-orange/15 text-orange' : 'bg-red/15 text-red')

/** Reconcile from bank statement: upload CSV → preview matches → confirm selected (STMT- references). */
export function ReconcileStatementDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<StatementPreview | null>(null)
  const [choices, setChoices] = useState<Record<number, Choice>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<StatementConfirmResult | null>(null)

  const loadFile = async (f: File) => {
    setFileName(f.name)
    setCsv(await f.text())
    setPreview(null)
    setResult(null)
  }

  const runPreview = async () => {
    setBusy(true)
    setError(null)
    try {
      const p = await statementApi.preview(csv)
      setPreview(p)
      const c: Record<number, Choice> = {}
      for (const r of p.rows) c[r.row] = { checked: !!r.match && r.match.confidence >= 60, candidateId: r.match?.batchItemId ?? null }
      setChoices(c)
    } catch (err) {
      setError(await apiErrorMessage(err, 'Could not read this statement.'))
    } finally {
      setBusy(false)
    }
  }

  const candidateOf = (r: StatementRow) => r.candidates.find((c) => c.batchItemId === choices[r.row]?.candidateId) ?? null
  const selectedRows = (preview?.rows ?? []).filter((r) => choices[r.row]?.checked && candidateOf(r))
  // The same batch line must not be claimed twice.
  const claimed = new Map<string, number>()
  for (const r of selectedRows) claimed.set(candidateOf(r)!.batchItemId, (claimed.get(candidateOf(r)!.batchItemId) ?? 0) + 1)
  const duplicates = [...claimed.values()].some((n) => n > 1)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await statementApi.confirm(
        selectedRows.map((row) => {
          const c = candidateOf(row)!
          return {
            batchItemId: c.batchItemId,
            amount: c.suggestedAmount,
            debit: row.debit,
            statementDate: row.date ?? undefined,
            statementReference: row.reference || undefined,
            description: row.description || undefined,
            row: row.row,
          }
        }),
      )
      setResult(r)
      qc.invalidateQueries({ queryKey: batchKeys.all })
    } catch (err) {
      setError(await apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={busy ? () => undefined : onClose}
      title="Reconcile from bank statement"
      description="Upload your bank statement CSV. Debits are matched to unpaid lines by amount, vendor name and account number."
      className="sm:max-w-4xl"
      footer={
        result ? (
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            {!preview ? (
              <Button size="sm" isLoading={busy} disabled={!csv.trim()} onClick={runPreview}>
                Preview matches
              </Button>
            ) : (
              <Button size="sm" isLoading={busy} disabled={!selectedRows.length || duplicates} onClick={confirm}>
                Confirm {selectedRows.length} match{selectedRows.length === 1 ? '' : 'es'}
              </Button>
            )}
          </>
        )
      }
    >
      {error && <p className="mb-3 rounded-xl border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">{error}</p>}

      {result ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-border p-3">
              <MicroLabel>Recorded</MicroLabel>
              <p className="text-xl font-bold text-green">{result.recorded}</p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <MicroLabel>Already recorded</MicroLabel>
              <p className="text-xl font-bold">{result.alreadyRecorded}</p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <MicroLabel>Rejected</MicroLabel>
              <p className="text-xl font-bold text-red">{result.rejected}</p>
            </div>
          </div>
          {result.results.filter((r) => r.status === 'REJECTED').map((r) => (
            <p key={r.batchItemId} className="text-xs text-red">
              {r.message}
            </p>
          ))}
        </div>
      ) : !preview ? (
        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-sm text-text-dim hover:border-gold hover:text-gold"
          >
            <Upload size={20} />
            {fileName ? <span className="font-semibold text-foreground">{fileName}</span> : 'Choose a CSV file'}
            <span className="text-xs">Columns are auto-detected: date, narration/details, debit/withdrawal, reference.</span>
          </button>
          <details className="text-xs text-text-dim">
            <summary className="cursor-pointer">…or paste the CSV text</summary>
            <Textarea rows={6} className="mt-2 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} />
          </details>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-text-dim">
            {preview.debitRows} debit{preview.debitRows === 1 ? '' : 's'} found · {preview.matched} suggested match{preview.matched === 1 ? '' : 'es'} · columns: {preview.columns.date},{' '}
            {preview.columns.description ?? '—'}, {preview.columns.debit}, {preview.columns.reference ?? '—'}
          </p>
          {duplicates && <p className="text-xs text-red">Two statement rows point at the same line — untick one.</p>}
          <ul className="divide-y divide-border rounded-xl border border-border">
            {preview.rows.map((r) => {
              const ch = choices[r.row]
              const cand = candidateOf(r)
              return (
                <li key={r.row} className={cn('flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center', !r.candidates.length && 'opacity-60')}>
                  <label className="flex min-w-0 flex-1 items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-[var(--gold)]"
                      disabled={!r.candidates.length}
                      checked={!!ch?.checked && !!cand}
                      onChange={(e) => setChoices((s) => ({ ...s, [r.row]: { ...(s[r.row] ?? { candidateId: null }), checked: e.target.checked } }))}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold tabular-nums">
                        {naira(r.debit)} <span className="font-normal text-text-dim">· {r.date ? fmtDate(r.date) : 'no date'} · row {r.row}</span>
                      </span>
                      <span className="block truncate text-xs text-text-dim">{r.description || r.reference || '—'}</span>
                    </span>
                  </label>
                  <div className="min-w-0 lg:w-[55%]">
                    {r.candidates.length === 0 ? (
                      <span className="text-xs text-text-muted">No matching line</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <select
                          value={ch?.candidateId ?? ''}
                          onChange={(e) => setChoices((s) => ({ ...s, [r.row]: { checked: true, candidateId: e.target.value } }))}
                          className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-xs"
                        >
                          {r.candidates.map((c) => (
                            <option key={c.batchItemId} value={c.batchItemId}>
                              {c.vendorName} · {c.batchRef} · {naira(c.suggestedAmount)} of {naira(c.outstanding)} ({c.confidence}%)
                            </option>
                          ))}
                        </select>
                        {cand && (
                          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', confidenceCls(cand.confidence))} title={cand.reasons.join(', ')}>
                            {cand.confidence}%
                          </span>
                        )}
                      </div>
                    )}
                    {cand && <p className="mt-0.5 truncate text-[11px] text-text-muted">Matched on {cand.reasons.join(', ')}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
          <button className="text-xs text-gold hover:underline" onClick={() => setPreview(null)}>
            Use a different file
          </button>
        </div>
      )}
    </Sheet>
  )
}
