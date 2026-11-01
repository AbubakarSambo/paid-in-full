import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileUp } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { formatNaira } from '@/lib/money'
import { budgetKeys, budgetsApi } from '@/lib/api/budgets'
import { apiErrorMessage } from '@/lib/api/queue'
import type { BudgetImportPreview } from '@/types/budgets'
import { ModalFooter } from '@/components/queue/common'
import { readFileText } from '@/components/queue/helpers'

/** Row mapping value: an existing tag id, `new:` (create from label), or '' (skip). */
type Mapping = Record<number, { target: string; newName: string }>

const sel = 'h-9 w-full rounded-md border border-input bg-card px-2 text-xs focus:border-gold focus:outline-none'

export function ImportBudgetWizard({
  open,
  onClose,
  period,
  bu,
  businessUnits,
}: {
  open: boolean
  onClose: () => void
  period: string
  bu: string
  businessUnits: { id: string; name: string }[]
}) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [csv, setCsv] = useState('')
  const [targetBu, setTargetBu] = useState('')
  const [preview, setPreview] = useState<BudgetImportPreview | null>(null)
  const [cols, setCols] = useState<{ label: number | null; amount: number | null; hasHeader: boolean }>({ label: null, amount: null, hasHeader: true })
  const [map, setMap] = useState<Mapping>({})

  useEffect(() => {
    if (!open) return
    setStep(1)
    setCsv('')
    setPreview(null)
    setMap({})
    setTargetBu(bu === 'all' || bu === 'none' ? '' : bu)
  }, [open, bu])

  const runPreview = useMutation({
    mutationFn: (opts: { label?: number; amount?: number; hasHeader?: boolean }) =>
      budgetsApi.importPreview({ csv, labelColumn: opts.label, amountColumn: opts.amount, hasHeader: opts.hasHeader }),
    onSuccess: (p) => {
      setPreview(p)
      setCols({ label: p.labelColumn, amount: p.amountColumn, hasHeader: p.hasHeader })
      setMap(
        Object.fromEntries(
          p.rows.map((r) => [r.row, { target: r.suggestedCoaTagId ?? (r.valid ? 'new:' : ''), newName: r.label }]),
        ),
      )
      setStep(2)
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })

  const remap = (patch: Partial<typeof cols>) => {
    const next = { ...cols, ...patch }
    setCols(next)
    runPreview.mutate({ label: next.label ?? undefined, amount: next.amount ?? undefined, hasHeader: next.hasHeader })
  }

  const mapped = (preview?.rows ?? []).filter((r) => r.valid && map[r.row]?.target)
  const tagName = (id: string) => preview?.tags?.find((t) => t.id === id)?.name ?? ''

  const commit = useMutation({
    mutationFn: () =>
      budgetsApi.importCommit({
        period,
        costCenterId: targetBu || undefined,
        rows: mapped.map((r) => {
          const m = map[r.row]
          return m.target === 'new:'
            ? { label: r.label, amount: r.amount ?? 0, newTagName: m.newName.trim() || r.label }
            : { label: r.label, amount: r.amount ?? 0, coaTagId: m.target }
        }),
      }),
    onSuccess: (res) => {
      toast.success(`Imported ${res.imported} cap${res.imported === 1 ? '' : 's'}${res.createdTags.length ? ` · ${res.createdTags.length} new tag(s)` : ''}`)
      qc.invalidateQueries({ queryKey: budgetKeys.all })
      qc.invalidateQueries({ queryKey: ['coa-tags'] })
      onClose()
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })

  const steps = ['Upload', 'Map', 'Review']

  return (
    <Modal isOpen={open} onClose={onClose} title={`Import budget · ${period}`} className="max-w-3xl">
      <div className="mb-4 flex gap-2">
        {steps.map((s, i) => (
          <div
            key={s}
            className={cn(
              'flex-1 rounded-full py-1 text-center text-[11px] font-semibold uppercase tracking-wider',
              step === i + 1 ? 'bg-gold/15 text-gold' : step > i + 1 ? 'bg-green/10 text-green' : 'bg-surface2 text-text-muted',
            )}
          >
            {i + 1}. {s}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-text-dim">Upload or paste a CSV with a cost line and a budget amount, e.g. “Cost line,Budget”.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <FileUp size={14} /> Choose file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) setCsv(await readFileText(f))
              }}
            />
          </div>
          <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'Cost line,Budget\nDiesel,500000\nCleaning,120000'} className="font-mono text-xs" />
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">Business Unit for these caps</div>
            <select className={sel} value={targetBu} onChange={(e) => setTargetBu(e.target.value)}>
              <option value="">Workspace-wide (no BU)</option>
              {businessUnits.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {step === 2 && preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="space-y-1 text-[11px] font-semibold uppercase tracking-wider text-text-dim">
              Label column
              <select className={sel} value={cols.label ?? ''} onChange={(e) => remap({ label: Number(e.target.value) })}>
                <option value="" disabled>
                  Pick…
                </option>
                {preview.columns.map((c) => (
                  <option key={c.index} value={c.index}>
                    {c.header} {c.sample.length ? `(${c.sample[0]})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-[11px] font-semibold uppercase tracking-wider text-text-dim">
              Amount column
              <select className={sel} value={cols.amount ?? ''} onChange={(e) => remap({ amount: Number(e.target.value) })}>
                <option value="" disabled>
                  Pick…
                </option>
                {preview.columns.map((c) => (
                  <option key={c.index} value={c.index}>
                    {c.header} {c.sample.length ? `(${c.sample[0]})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pt-5 text-xs">
              <input type="checkbox" className="accent-[var(--gold)]" checked={cols.hasHeader} onChange={(e) => remap({ hasHeader: e.target.checked })} />
              First row is a header
            </label>
          </div>
          {preview.rows.length === 0 ? (
            <div className="rounded-xl border border-border p-6 text-center text-sm text-text-dim">Pick the label and amount columns to see rows.</div>
          ) : (
            <div className="max-h-[45vh] space-y-1.5 overflow-y-auto">
              {preview.rows.map((r) => {
                const m = map[r.row] ?? { target: '', newName: r.label }
                return (
                  <div key={r.row} className={cn('grid grid-cols-12 items-center gap-2 rounded-lg border px-2 py-1.5', r.valid ? 'border-border' : 'border-red/40 bg-red/5')}>
                    <div className="col-span-12 truncate text-sm sm:col-span-4">
                      {r.label || <span className="text-text-muted">(blank)</span>}
                      {r.match === 'fuzzy' && <span className="ml-1 text-[10px] text-orange">fuzzy</span>}
                    </div>
                    <div className="col-span-4 text-right text-sm tabular-nums sm:col-span-2">{r.amount === null ? '—' : formatNaira(r.amount)}</div>
                    <div className="col-span-8 sm:col-span-6">
                      {r.valid ? (
                        <div className="flex gap-1">
                          <select className={sel} value={m.target} onChange={(e) => setMap((x) => ({ ...x, [r.row]: { ...m, target: e.target.value } }))}>
                            <option value="">Skip this row</option>
                            <option value="new:">+ New tag…</option>
                            {(preview.tags ?? []).map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} · {t.payCategory}
                              </option>
                            ))}
                          </select>
                          {m.target === 'new:' && (
                            <input
                              className={sel}
                              value={m.newName}
                              onChange={(e) => setMap((x) => ({ ...x, [r.row]: { ...m, newName: e.target.value } }))}
                              placeholder="New tag name"
                            />
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-red">Row {r.row}: missing label or amount</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-2">
          <p className="text-sm text-text-dim">
            These caps will be written for <b>{period}</b> · {targetBu ? businessUnits.find((b) => b.id === targetBu)?.name : 'workspace-wide'}. Rows mapped to the
            same tag are added together; existing caps are replaced.
          </p>
          <div className="max-h-[45vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {mapped.map((r) => {
              const m = map[r.row]
              return (
                <div key={r.row} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="truncate">
                    {r.label} → <b>{m.target === 'new:' ? `${m.newName || r.label} (new)` : tagName(m.target)}</b>
                  </span>
                  <span className="tabular-nums">{formatNaira(r.amount)}</span>
                </div>
              )
            })}
          </div>
          <div className="text-right text-sm">
            Total <b className="tabular-nums">{formatNaira(mapped.reduce((s, r) => s + (r.amount ?? 0), 0))}</b>
          </div>
        </div>
      )}

      <ModalFooter>
        <Button variant="outline" size="sm" onClick={step === 1 ? onClose : () => setStep((s) => (s - 1) as 1 | 2)}>
          {step === 1 ? 'Cancel' : 'Back'}
        </Button>
        {step === 1 && (
          <Button size="sm" disabled={!csv.trim()} isLoading={runPreview.isPending} onClick={() => runPreview.mutate({})}>
            Next
          </Button>
        )}
        {step === 2 && (
          <Button size="sm" disabled={!mapped.length} onClick={() => setStep(3)}>
            Review {mapped.length}
          </Button>
        )}
        {step === 3 && (
          <Button size="sm" isLoading={commit.isPending} onClick={() => commit.mutate()}>
            Import
          </Button>
        )}
      </ModalFooter>
    </Modal>
  )
}
