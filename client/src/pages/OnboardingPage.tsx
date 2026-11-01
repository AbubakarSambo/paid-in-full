import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Building2, Check, ImagePlus, Landmark, Plus, Tags, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { authApi, apiError, onboardingApi, workspaceShellApi } from '@/lib/api/shell'
import { useAuthStore } from '@/stores/authStore'
import { ROLE_LABELS, ROLE_ORDER, isAdmin } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { CURRENCIES, INDUSTRIES, timezones } from '@/components/layout/shellStore'
import type { WorkspaceRoleName } from '@/types/shell'

const STEPS = [
  { key: 'workspace', label: 'Workspace', icon: Building2 },
  { key: 'categories', label: 'Categories', icon: Tags },
  { key: 'monnify', label: 'Wallet', icon: Landmark },
  { key: 'team', label: 'Team', icon: Users },
] as const

interface InviteRow {
  email: string
  name: string
  role: WorkspaceRoleName
}

/** Spec §2 /onboarding wizard → POST /onboarding/wizard. */
export default function OnboardingPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { workspace, role, setSession, setNeedsOnboarding } = useAuthStore()
  const [step, setStep] = useState(0)
  const [name, setName] = useState(workspace?.name ?? '')
  const [logoUrl, setLogoUrl] = useState<string | null>(workspace?.logoUrl ?? null)
  const [currency, setCurrency] = useState('NGN')
  const [timezone, setTimezone] = useState('Africa/Lagos')
  const [industry, setIndustry] = useState('Hospitality')
  const [createDefaults, setCreateDefaults] = useState(true)
  const [invites, setInvites] = useState<InviteRow[]>([{ email: '', name: '', role: 'POSTER' }])

  const { data: ws } = useQuery({ queryKey: ['workspace'], queryFn: workspaceShellApi.get, enabled: !!workspace })
  useEffect(() => {
    if (!ws) return
    setName((n) => n || ws.name)
    setCurrency(ws.currency || 'NGN')
    setTimezone(ws.timezone || 'Africa/Lagos')
    if (ws.industry) setIndustry(ws.industry)
    setLogoUrl(ws.logoUrl)
  }, [ws])

  const logo = useMutation({
    mutationFn: workspaceShellApi.uploadLogo,
    onSuccess: (w) => {
      setLogoUrl(w.logoUrl)
      toast.success('Logo uploaded')
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  const finish = useMutation({
    mutationFn: (skip: boolean) =>
      onboardingApi.wizard(
        skip
          ? {}
          : {
        name: name.trim() || undefined,
        currency,
        timezone,
        industry,
        createDefaultCategories: createDefaults,
        invites: invites.filter((i) => i.email.trim()).map((i) => ({ email: i.email.trim(), name: i.name.trim() || i.email.split('@')[0], role: i.role })),
            }
      ),
    onSuccess: async (r) => {
      setNeedsOnboarding(false)
      const failed = r.invites.filter((i) => !i.ok)
      if (failed.length) toast.warning(`Couldn't invite ${failed.map((f) => f.email).join(', ')}: ${failed[0].error ?? 'unknown error'}`)
      toast.success(
        r.categoriesCreated
          ? `You're all set. Created ${r.categoriesCreated} categories and ${r.coaTagsCreated} COA tags.`
          : "You're all set."
      )
      try {
        setSession(await authApi.session())
      } catch {
        /* keep current session */
      }
      qc.invalidateQueries()
      navigate('/app/queue', { replace: true })
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  const admin = isAdmin(role)
  useEffect(() => {
    if (workspace && !admin) setNeedsOnboarding(false)
  }, [workspace, admin, setNeedsOnboarding])

  if (!workspace) return <Navigate to="/" replace />
  if (!admin) return <Navigate to="/app/queue" replace />

  const canNext = step !== 0 || name.trim().length >= 2
  const last = step === STEPS.length - 1

  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold font-display text-lg font-black text-primary-foreground">₦</div>
          <span className="font-display font-bold text-foreground">Let's set up {workspace.name}</span>
        </div>

        <ol className="mb-6 grid grid-cols-4 gap-2">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex flex-col items-center gap-1.5 text-center">
              <span
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full border text-sm',
                  i < step ? 'border-green bg-green text-white' : i === step ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-muted'
                )}
              >
                {i < step ? <Check size={16} /> : <s.icon size={16} />}
              </span>
              <span className={cn('text-[11px] font-semibold uppercase tracking-wider', i === step ? 'text-foreground' : 'text-text-muted')}>{s.label}</span>
            </li>
          ))}
        </ol>

        <div className="rounded-2xl border border-border bg-card p-5 sm:p-7">
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-foreground">Your workspace</h2>
                <p className="text-sm text-text-dim">This is how your business appears on batches, receipts and invoices.</p>
              </div>
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  <img src={logoUrl} alt="" className="h-16 w-16 rounded-2xl border border-border object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-border text-text-muted">
                    <ImagePlus size={22} />
                  </div>
                )}
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (!f) return
                      if (f.size > 2 * 1024 * 1024) return toast.error('Logo must be 2 MB or smaller.')
                      logo.mutate(f)
                    }}
                  />
                  <span className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-xs font-semibold text-foreground hover:border-gold/40">
                    {logo.isPending ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
                  </span>
                  <p className="mt-1 text-xs text-text-muted">PNG or JPG, up to 2 MB.</p>
                </label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ws-name">Workspace name</Label>
                <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cur">Currency</Label>
                  <Select id="cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tz">Timezone</Label>
                  <Select id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {timezones().map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ind">Industry</Label>
                <Select id="ind" value={industry} onChange={(e) => setIndustry(e.target.value)}>
                  {INDUSTRIES.map((i) => (
                    <option key={i}>{i}</option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-foreground">Payment categories</h2>
                <p className="text-sm text-text-dim">Every payment is tagged Category → Chart of Accounts. Start with sensible defaults, or skip and set your own up later.</p>
              </div>
              <label className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-4', createDefaults ? 'border-gold/50 bg-gold/5' : 'border-border')}>
                <input type="checkbox" className="mt-1 accent-[var(--gold)]" checked={createDefaults} onChange={(e) => setCreateDefaults(e.target.checked)} />
                <div>
                  <p className="font-semibold text-foreground">Create default categories</p>
                  <p className="text-sm text-text-dim">Cost of Sale, Operating Expense and Asset, with starter COA tags tailored to {industry}.</p>
                </div>
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-foreground">How money moves</h2>
              <p className="text-sm text-text-dim">Paid in Full pays vendors from a workspace wallet powered by Monnify.</p>
              <ol className="space-y-3 text-sm">
                {[
                  ['Your wallet', 'Your workspace gets a dedicated bank account number (NUBAN). Top up by bank transfer from any bank.'],
                  ['Approve', 'Approvers turn queue items into batches, one per category.'],
                  ['Disburse', 'A payer sends the batch with their PIN and the typed total. Monnify pays each vendor, with WHT sent to your tax account.'],
                  ['Track', 'Every line is recorded, receipted, and synced to your Google Sheet.'],
                ].map(([t, b], i) => (
                  <li key={t} className="flex gap-3 rounded-xl border border-border bg-surface2 p-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold/15 text-xs font-bold text-gold">{i + 1}</span>
                    <div>
                      <p className="font-semibold text-foreground">{t}</p>
                      <p className="text-text-dim">{b}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-text-muted">You can provision or link your wallet later in Settings → Wallet Account. The PIF team can help you get it set up.</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-foreground">Invite your team</h2>
                <p className="text-sm text-text-dim">They'll get an email link to set their own password. You can always do this later from the Users tab.</p>
              </div>
              {invites.map((inv, i) => (
                <div key={i} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1.4fr_1fr_0.9fr_auto] sm:border-0 sm:p-0">
                  <Input placeholder="Email" type="email" value={inv.email} onChange={(e) => setInvites(invites.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                  <Input placeholder="Name" value={inv.name} onChange={(e) => setInvites(invites.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <Select value={inv.role} onChange={(e) => setInvites(invites.map((x, j) => (j === i ? { ...x, role: e.target.value as WorkspaceRoleName } : x)))}>
                    {[...ROLE_ORDER].reverse().map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setInvites(invites.filter((_, j) => j !== i))}>
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setInvites([...invites, { email: '', name: '', role: 'POSTER' }])}>
                <Plus size={14} /> Add another
              </Button>
            </div>
          )}

          <div className="mt-7 flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => (step === 0 ? finish.mutate(true) : setStep(step - 1))} disabled={finish.isPending}>
              {step === 0 ? 'Skip setup' : 'Back'}
            </Button>
            <Button onClick={() => (last ? finish.mutate(false) : setStep(step + 1))} disabled={!canNext} isLoading={finish.isPending}>
              {last ? 'Finish setup' : 'Continue'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
