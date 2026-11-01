import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { sheetsApi } from '@/lib/api/sheets'
import { usePermissions } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { errorMessageSync } from '@/components/reports/format'
import { Skeleton } from '@/components/reports/primitives'
import { EnvironmentNotes, Field, Notice, ReadOnlyNote, SettingsCard, transportLabel } from '@/components/reports/SheetsShared'

export default function SheetsInvoices() {
  const { isAdmin } = usePermissions()
  const qc = useQueryClient()
  const config = useQuery({ queryKey: ['sheets', 'config'], queryFn: sheetsApi.getConfig, enabled: isAdmin })
  const [url, setUrl] = useState('')
  const [tab, setTab] = useState('INVOICES')

  useEffect(() => {
    if (!config.data) return
    setUrl(config.data.invoicesSheetsUrl ?? '')
    setTab(config.data.invoicesTabName || 'INVOICES')
  }, [config.data])

  const save = useMutation({
    mutationFn: () => sheetsApi.saveConfig({ invoicesSheetsUrl: url.trim(), invoicesTabName: tab.trim() || 'INVOICES' }),
    onSuccess: () => {
      toast.success('Invoice sheet settings saved')
      qc.invalidateQueries({ queryKey: ['sheets'] })
    },
    onError: (e) => toast.error(errorMessageSync(e, 'Could not save')),
  })
  const test = useMutation({
    mutationFn: () => sheetsApi.test('invoices'),
    onSuccess: (r) => toast.success(r.mock ? `${r.message} (mock mode)` : r.message),
    onError: (e) => toast.error(errorMessageSync(e, 'Sheet test failed')),
  })

  const cfg = config.data
  const dirty = !!cfg && (url !== (cfg.invoicesSheetsUrl ?? '') || tab !== (cfg.invoicesTabName || 'INVOICES'))
  const configured = !!cfg?.invoicesTransport

  return (
    <SettingsCard id="sheets-invoices" title="Google Sheets sync — Invoices" description="Issued invoices and their payments are written to an INVOICES tab.">
      {!isAdmin ? (
        <ReadOnlyNote />
      ) : config.isLoading ? (
        <Skeleton className="h-28" />
      ) : config.isError || !cfg ? (
        <Notice tone="error">{errorMessageSync(config.error, 'Could not load sheet settings')}</Notice>
      ) : (
        <>
          {!configured ? <Notice tone="warn">Not configured — invoices are not being synced to a sheet.</Notice> : null}
          <EnvironmentNotes config={cfg} />
          <div className="grid gap-4 md:grid-cols-[1fr_200px]">
            <Field label="Sheet URL or Apps Script /exec URL" hint={configured ? `Detected: ${transportLabel(cfg.invoicesTransport)}` : undefined}>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
            </Field>
            <Field label="Tab name">
              <Input value={tab} onChange={(e) => setTab(e.target.value)} placeholder="INVOICES" />
            </Field>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => test.mutate()} isLoading={test.isPending} disabled={!configured || dirty} title={dirty ? 'Save first' : undefined}>
              Test (writes a TEST row)
            </Button>
            <Button size="sm" onClick={() => save.mutate()} isLoading={save.isPending} disabled={!dirty}>
              Save
            </Button>
          </div>
        </>
      )}
    </SettingsCard>
  )
}
