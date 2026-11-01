import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { apiError, workspaceShellApi, type UpdateWorkspacePayload } from '@/lib/api/shell'
import { usePermissions } from '@/lib/permissions'
import { useAuthStore } from '@/stores/authStore'
import { useWorkspaceConfig } from '@/components/layout/hooks'
import { CURRENCIES, INDUSTRIES, timezones } from '@/components/layout/shellStore'
import type { WorkspaceDetail } from '@/types/shell'
import { ReadOnly, Row, SectionCard } from '../SectionCard'

const LOGO_MAX = 2 * 1024 * 1024

/**
 * §5.10 #4 Workspace: name, logo (≤ 2 MB), currency, timezone, industry, TIN and the
 * "Require Business Unit on every entry" toggle. BU management is the BusinessUnits section.
 */
export default function Workspace() {
  const qc = useQueryClient()
  const { isAdmin } = usePermissions()
  const updateWorkspace = useAuthStore((s) => s.updateWorkspace)
  const { data: ws, isLoading } = useWorkspaceConfig()
  const [form, setForm] = useState({ name: '', currency: 'NGN', timezone: 'Africa/Lagos', industry: '', tin: '' })
  const tzs = useMemo(() => timezones(), [])

  useEffect(() => {
    if (ws) setForm({ name: ws.name, currency: ws.currency || 'NGN', timezone: ws.timezone || 'Africa/Lagos', industry: ws.industry ?? '', tin: ws.tin ?? '' })
  }, [ws])

  const onSaved = (w: WorkspaceDetail) => {
    qc.setQueryData(['workspace'], w)
    updateWorkspace({ name: w.name, logoUrl: w.logoUrl })
  }

  const save = useMutation({
    mutationFn: (p: UpdateWorkspacePayload) => workspaceShellApi.update(p),
    onSuccess: (w) => {
      onSaved(w)
      toast.success('Workspace saved')
    },
    onError: (e) => toast.error(apiError(e).message),
  })
  const logo = useMutation({
    mutationFn: workspaceShellApi.uploadLogo,
    onSuccess: (w) => {
      onSaved(w)
      toast.success('Logo updated')
    },
    onError: (e) => toast.error(apiError(e).message),
  })
  const buToggle = useMutation({
    mutationFn: (on: boolean) => workspaceShellApi.update({ businessUnitsRequired: on }),
    onSuccess: (w) => onSaved(w),
    onError: (e) => toast.error(apiError(e).message),
  })

  const currencies = ws?.options?.currencies?.length ? ws.options.currencies : CURRENCIES
  const industries = ws?.options?.industries?.length ? ws.options.industries : INDUSTRIES
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <SectionCard title="Workspace" description="Your business details, used on batches, receipts and invoices.">
      {!isAdmin && <ReadOnly />}
      {isLoading ? (
        <p className="text-sm text-text-dim">Loading…</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (form.name.trim().length < 2) return toast.error('Workspace name must be at least 2 characters.')
            if (form.tin && !/^[0-9A-Za-z-]{0,20}$/.test(form.tin.trim())) return toast.error('TIN should be digits/letters only.')
            save.mutate({ name: form.name.trim(), currency: form.currency, timezone: form.timezone, industry: form.industry, tin: form.tin.trim() })
          }}
        >
          <fieldset disabled={!isAdmin} className="space-y-4">
            <div className="flex items-center gap-4">
              {ws?.logoUrl ? (
                <img src={ws.logoUrl} alt="" className="h-16 w-16 rounded-2xl border border-border object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-border text-text-muted">
                  <ImagePlus size={20} />
                </div>
              )}
              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:border-gold/40">
                    {logo.isPending ? 'Uploading…' : ws?.logoUrl ? 'Change logo' : 'Upload logo'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        e.target.value = ''
                        if (!f) return
                        if (f.size > LOGO_MAX) return toast.error('Logo must be 2 MB or smaller.')
                        logo.mutate(f)
                      }}
                    />
                  </label>
                  {ws?.logoUrl && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => save.mutate({ logoUrl: null })}>
                      Remove
                    </Button>
                  )}
                  <p className="w-full text-xs text-text-muted">Max 2 MB.</p>
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ws-n">Name</Label>
                <Input id="ws-n" value={form.name} onChange={set('name')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ws-tin">Workspace TIN</Label>
                <Input id="ws-tin" value={form.tin} onChange={set('tin')} placeholder="Tax identification number" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ws-cur">Default currency</Label>
                <Select id="ws-cur" value={form.currency} onChange={set('currency')}>
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ws-tz">Timezone</Label>
                <Select id="ws-tz" value={form.timezone} onChange={set('timezone')}>
                  {(tzs.includes(form.timezone) ? tzs : [form.timezone, ...tzs]).map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="ws-ind">Industry</Label>
                <Select id="ws-ind" value={form.industry} onChange={set('industry')}>
                  <option value="">—</option>
                  {industries.map((i) => (
                    <option key={i}>{i}</option>
                  ))}
                </Select>
              </div>
            </div>
          </fieldset>
          <Row label="Require Business Unit on every entry" hint="Queue items and requisitions can't be saved without a Business Unit.">
            <Switch
              checked={!!ws?.settings?.businessUnitsRequired}
              disabled={!isAdmin || buToggle.isPending}
              onChange={(on) => buToggle.mutate(on)}
              label="Require Business Unit"
            />
          </Row>
          {isAdmin && (
            <div className="flex justify-end">
              <Button type="submit" isLoading={save.isPending}>
                Save workspace
              </Button>
            </div>
          )}
        </form>
      )}
    </SectionCard>
  )
}
