import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ExternalLink } from 'lucide-react'
import { sheetsApi } from '@/lib/api/sheets'
import { usePermissions } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog, Modal } from '@/components/ui/dialog'
import { errorMessageSync } from '@/components/reports/format'
import { Skeleton } from '@/components/reports/primitives'
import { EnvironmentNotes, Field, Notice, ReadOnlyNote, SettingsCard, SyncStatusLine, transportLabel } from '@/components/reports/SheetsShared'

const WIPE_PHRASE = 'WIPE'

export default function SheetsBatches() {
  const { isAdmin } = usePermissions()
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['sheets', 'status'], queryFn: sheetsApi.status })
  const config = useQuery({ queryKey: ['sheets', 'config'], queryFn: sheetsApi.getConfig, enabled: isAdmin })

  const [url, setUrl] = useState('')
  const [tab, setTab] = useState('BATCHES')
  const [reconUrl, setReconUrl] = useState('')
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`)
  const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0)
  const [phrase, setPhrase] = useState('')

  useEffect(() => {
    if (!config.data) return
    setUrl(config.data.sheetsUrl ?? '')
    setTab(config.data.batchesTabName || 'BATCHES')
    setReconUrl(config.data.reconSheetUrl ?? '')
  }, [config.data])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sheets'] })
  }

  const save = useMutation({
    mutationFn: () => sheetsApi.saveConfig({ sheetsUrl: url.trim(), batchesTabName: tab.trim() || 'BATCHES', reconSheetUrl: reconUrl.trim() }),
    onSuccess: () => {
      toast.success('Sheet settings saved')
      refresh()
    },
    onError: (e) => toast.error(errorMessageSync(e, 'Could not save sheet settings')),
  })
  const test = useMutation({
    mutationFn: () => sheetsApi.test('batches'),
    onSuccess: (r) => toast.success(r.mock ? `${r.message} (mock mode)` : r.message),
    onError: (e) => toast.error(errorMessageSync(e, 'Sheet test failed')),
  })
  const backfill = useMutation({
    mutationFn: () => sheetsApi.backfill(from),
    onSuccess: (r) => {
      toast.success(r.message ?? `Backfilled ${r.batches ?? 0} batch(es), ${r.rows ?? 0} row(s)`)
      refresh()
    },
    onError: (e) => toast.error(errorMessageSync(e, 'Backfill failed')),
  })
  const wipe = useMutation({
    mutationFn: sheetsApi.wipeRepush,
    onSuccess: (r) => {
      toast.success(r.message ?? `Sheet rewritten: ${r.rows ?? 0} row(s)`)
      setConfirmStep(0)
      setPhrase('')
      refresh()
    },
    onError: (e) => toast.error(errorMessageSync(e, 'Wipe & repush failed')),
  })

  const cfg = config.data
  const dirty = !!cfg && (url !== (cfg.sheetsUrl ?? '') || tab !== (cfg.batchesTabName || 'BATCHES') || reconUrl !== (cfg.reconSheetUrl ?? ''))
  const configured = !!status.data?.configured
  const isAppsScript = /script\.google\.com\/.*\/exec/.test(url)

  return (
    <SettingsCard
      id="sheets-batches"
      title="Google Sheets sync — Batches"
      description="Approved and disbursed batches are written to your mastersheet's BATCHES tab (16 columns, row 1 kept as the header)."
    >
      {status.isLoading ? <Skeleton className="h-10" /> : status.data ? <SyncStatusLine status={status.data} /> : null}

      {!isAdmin ? (
        <ReadOnlyNote />
      ) : config.isLoading ? (
        <Skeleton className="h-40" />
      ) : config.isError || !cfg ? (
        <Notice tone="error">{errorMessageSync(config.error, 'Could not load sheet settings')}</Notice>
      ) : (
        <>
          <EnvironmentNotes config={cfg} />
          <div className="grid gap-4 md:grid-cols-[1fr_200px]">
            <Field
              label="Sheet URL or Apps Script /exec URL"
              hint={cfg.batchesTransport ? `Detected: ${transportLabel(cfg.batchesTransport)}` : 'Not configured — paste a Google Sheets link or an Apps Script web-app URL.'}
            >
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/… or https://script.google.com/…/exec" />
            </Field>
            <Field label="Tab name">
              <Input value={tab} onChange={(e) => setTab(e.target.value)} placeholder="BATCHES" />
            </Field>
          </div>
          <Field
            label="Reconciliation sheet link"
            hint={isAppsScript ? 'Required with an Apps Script URL: Sheet Recon reads this Google Sheet directly.' : 'Optional. Used by Sheet Recon; defaults to the sheet above.'}
          >
            <div className="flex gap-2">
              <Input value={reconUrl} onChange={(e) => setReconUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
              {reconUrl ? (
                <a href={reconUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 shrink-0 items-center rounded-xl border border-border px-3 text-text-dim hover:text-gold" aria-label="Open reconciliation sheet">
                  <ExternalLink className="h-4 w-4" />
                </a>
              ) : null}
            </div>
          </Field>
          {isAppsScript && !reconUrl ? <Notice tone="warn">Add a reconciliation sheet link — Apps Script URLs can't be read back for Sheet Recon.</Notice> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => test.mutate()} isLoading={test.isPending} disabled={!configured || dirty} title={dirty ? 'Save first' : !configured ? 'Not configured' : undefined}>
              Test (writes a TEST row)
            </Button>
            <Button size="sm" onClick={() => save.mutate()} isLoading={save.isPending} disabled={!dirty}>
              Save
            </Button>
          </div>

          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Backfill missing batches</h3>
            <p className="mt-1 text-xs text-text-dim">Pushes every batch dated on or after this day that isn't in the sheet yet.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[170px]" aria-label="Backfill from" />
              <Button variant="outline" size="sm" onClick={() => backfill.mutate()} isLoading={backfill.isPending} disabled={!configured || !from}>
                Backfill
              </Button>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Wipe &amp; repush</h3>
            <p className="mt-1 text-xs text-text-dim">Clears the tab and rewrites every row in the current 16-column layout. Manual edits in that tab are lost.</p>
            <Button variant="destructive" size="sm" className="mt-3" onClick={() => setConfirmStep(1)} disabled={!configured}>
              Wipe &amp; repush
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        isOpen={confirmStep === 1}
        onClose={() => setConfirmStep(0)}
        onConfirm={() => setConfirmStep(2)}
        title="Wipe and repush the sheet?"
        description={`Every row in the "${tab || 'BATCHES'}" tab will be deleted and rewritten from the app. Anything typed into that tab by hand will be lost.`}
        confirmText="Continue"
        isDangerous
      />
      <Modal isOpen={confirmStep === 2} onClose={() => (wipe.isPending ? undefined : setConfirmStep(0))} title="Final confirmation" description={`Type ${WIPE_PHRASE} to rewrite the sheet.`}>
        <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={WIPE_PHRASE} autoFocus />
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={() => setConfirmStep(0)} disabled={wipe.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => wipe.mutate()} isLoading={wipe.isPending} disabled={phrase.trim().toUpperCase() !== WIPE_PHRASE}>
            Wipe &amp; repush
          </Button>
        </div>
      </Modal>
    </SettingsCard>
  )
}
