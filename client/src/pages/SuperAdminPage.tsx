import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Copy, ExternalLink, LogOut, Plus, Search, Settings2, Trash2, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/dialog'
import { apiError, superAdminApi } from '@/lib/api/shell'
import { usePermissions } from '@/lib/permissions'
import { useAuthStore } from '@/stores/authStore'
import { Chip } from '@/components/layout/Dropdown'
import { Logo } from '@/components/layout/Header'
import { copyText, naira, timeAgo, useShellUi, applySkin } from '@/components/layout/shellStore'
import { cn } from '@/lib/utils'
import type { ClientRow, ManageClientPayload, WorkspaceStatusName } from '@/types/shell'

const STATUSES: WorkspaceStatusName[] = ['LEAD', 'TRIAL', 'ACTIVE', 'DEAD', 'PAUSED', 'SUSPENDED']
const STATUS_CLASS: Record<string, string> = {
  LEAD: 'border-blue/30 bg-blue/10 text-blue',
  TRIAL: 'border-purple/30 bg-purple/10 text-purple',
  ACTIVE: 'border-green/30 bg-green/10 text-green',
  DEAD: 'border-border bg-surface3 text-text-dim',
  PAUSED: 'border-orange/30 bg-orange/10 text-orange',
  SUSPENDED: 'border-red/30 bg-red/10 text-red',
}
const TIERS = ['STARTER', 'GROWTH', 'ENTERPRISE']
const ymd = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—')
const dateInput = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '')

type Tab = 'clients' | 'team' | 'autodebit'

/** Spec §14 /super-admin. CLIENT_SETUP staff see no money figures (the server strips them too). */
export default function SuperAdminPage() {
  const { isSuperAdmin } = usePermissions()
  const user = useAuthStore((s) => s.user)
  const workspace = useAuthStore((s) => s.workspace)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const { theme } = useShellUi()
  const [tab, setTab] = useState<Tab>('clients')

  useEffect(() => applySkin(user?.accentSkin as string | undefined), [user?.accentSkin])

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'clients', label: 'Clients' },
    ...(isSuperAdmin
      ? ([
          { key: 'team', label: 'Client setup team' },
          { key: 'autodebit', label: 'Auto-debit' },
        ] as Array<{ key: Tab; label: string }>)
      : []),
  ]

  return (
    <div className="min-h-screen bg-background" data-theme={theme}>
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 md:px-6">
          <Logo />
          <div className="min-w-0">
            <p className="font-display text-sm font-bold text-foreground">PIF Console</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gold">{isSuperAdmin ? 'Super admin' : 'Client setup'}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {workspace && (
              <Link to="/app/queue">
                <Button size="sm" variant="outline">
                  <ArrowLeft size={14} /> <span className="hidden sm:inline">Back to {workspace.name}</span>
                  <span className="sm:hidden">App</span>
                </Button>
              </Link>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                logout()
                navigate('/login')
              }}
            >
              <LogOut size={14} />
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-2 md:px-4">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'relative shrink-0 px-3 py-3 text-sm font-semibold after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full',
                tab === t.key ? 'text-foreground after:bg-gold' : 'text-text-dim hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-6">
        {tab === 'clients' && <ClientsTab />}
        {tab === 'team' && isSuperAdmin && <TeamTab />}
        {tab === 'autodebit' && isSuperAdmin && <AutoDebitTab />}
      </main>
    </div>
  )
}

// ─── Clients ────────────────────────────────────────────────────────────────

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-foreground sm:text-3xl">{value}</p>
    </div>
  )
}

function ClientsTab() {
  const { isSuperAdmin } = usePermissions()
  const setSession = useAuthStore((s) => s.switchWorkspace)
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState<WorkspaceStatusName | ''>('')
  const [managing, setManaging] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 300)
    return () => window.clearTimeout(t)
  }, [search])

  const kpis = useQuery({ queryKey: ['super-admin', 'kpis'], queryFn: superAdminApi.kpis })
  const clients = useQuery({ queryKey: ['super-admin', 'clients', debounced, status], queryFn: () => superAdminApi.clients({ search: debounced, status }) })

  const open = useMutation({
    mutationFn: superAdminApi.open,
    onSuccess: (s) => {
      setSession(s)
      toast.success(`Opened ${s.workspace?.name}`)
      navigate('/app/queue')
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total clients" value={kpis.data?.totalClients ?? '—'} />
        <Kpi label="Active clients" value={kpis.data?.activeClients ?? '—'} />
        {isSuperAdmin ? (
          <Kpi label="Monthly recurring" value={kpis.data?.monthlyRecurring != null ? naira(kpis.data.monthlyRecurring) : '—'} />
        ) : (
          <Kpi label="On trial" value={kpis.data?.trialClients ?? '—'} />
        )}
        <Kpi label="Paused / suspended" value={kpis.data?.pausedClients ?? '—'} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients by name or slug" className="pl-10" />
        </div>
        <div className="w-40">
          <Select value={status} onChange={(e) => setStatus(e.target.value as WorkspaceStatusName | '')}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={() => setNewOpen(true)} className="rounded-full">
          <Plus size={15} /> New client
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted">
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Status</th>
                {isSuperAdmin && <th className="px-4 py-3 text-right">Monthly</th>}
                <th className="px-4 py-3">Paid until</th>
                <th className="px-4 py-3 text-right">Members</th>
                <th className="px-4 py-3 text-right">Batches</th>
                {isSuperAdmin && <th className="px-4 py-3 text-right">Disbursed</th>}
                <th className="px-4 py-3">Last activity</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {clients.isLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-text-dim">
                    Loading…
                  </td>
                </tr>
              )}
              {clients.data?.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-text-dim">
                    No clients match.
                  </td>
                </tr>
              )}
              {clients.data?.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface2/50">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-foreground">{c.name}</p>
                    <p className="text-xs text-text-muted">{c.slug}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Chip className={STATUS_CLASS[c.status]}>{c.status}</Chip>
                    {c.overdue && <Chip className="ml-1 border-orange/30 bg-orange/10 text-orange">Past due</Chip>}
                  </td>
                  {isSuperAdmin && <td className="px-4 py-3 text-right tabular-nums">{c.monthlyAmount != null ? naira(c.monthlyAmount) : '—'}</td>}
                  <td className="px-4 py-3 tabular-nums text-text-dim">{ymd(c.paidUntil)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.members}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.batches}</td>
                  {isSuperAdmin && <td className="px-4 py-3 text-right tabular-nums">{naira(c.totalDisbursed ?? 0)}</td>}
                  <td className="px-4 py-3 text-text-dim">{c.lastActivityAt ? timeAgo(c.lastActivityAt) : '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {isSuperAdmin && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => open.mutate(c.id)} disabled={open.isPending} title="Open workspace">
                          <ExternalLink size={14} /> Open
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setManaging(c.id)}>
                          <Settings2 size={14} /> Manage
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {managing && <ManageModal id={managing} onClose={() => setManaging(null)} />}
      <NewClientModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}

function ManageModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: client, isLoading } = useQuery({ queryKey: ['super-admin', 'client', id], queryFn: () => superAdminApi.client(id) })
  const [form, setForm] = useState<Required<Omit<ManageClientPayload, 'extendPaidUntil'>> | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [dangerOpen, setDangerOpen] = useState(false)

  useEffect(() => {
    if (client)
      setForm({
        status: client.status,
        monthlyAmount: client.monthlyAmount ?? null,
        paidUntil: dateInput(client.paidUntil) || null,
        trialEndDate: dateInput(client.trialEndDate) || null,
        tier: client.tier ?? null,
        billingDay: client.billingDay ?? null,
        nextDueDate: dateInput(client.nextDueDate) || null,
        notes: client.notes ?? null,
      })
  }, [client])

  const refresh = (c?: ClientRow) => {
    if (c) qc.setQueryData(['super-admin', 'client', id], (old: ClientRow | undefined) => ({ ...(old ?? {}), ...c }))
    qc.invalidateQueries({ queryKey: ['super-admin', 'clients'] })
    qc.invalidateQueries({ queryKey: ['super-admin', 'kpis'] })
  }

  const save = useMutation({
    mutationFn: (p: ManageClientPayload) => superAdminApi.manage(id, p),
    onSuccess: (c, p) => {
      refresh(c)
      if (p.extendPaidUntil || Object.keys(p).length === 1) {
        setForm((f) => (f ? { ...f, paidUntil: dateInput(c.paidUntil) || null, monthlyAmount: c.monthlyAmount ?? f.monthlyAmount } : f))
        toast.success('Updated')
      } else {
        toast.success('Client saved')
        onClose()
      }
    },
    onError: (e) => toast.error(apiError(e).message),
  })
  const del = useMutation({
    mutationFn: () => superAdminApi.remove(id, confirmName),
    onSuccess: () => {
      refresh()
      toast.success('Client deleted')
      onClose()
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  const toIso = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toISOString() : null)
  const set = <K extends keyof NonNullable<typeof form>>(k: K, v: NonNullable<typeof form>[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

  return (
    <Modal isOpen onClose={onClose} title={client ? `Manage ${client.name}` : 'Manage client'} className="max-w-2xl">
      {isLoading || !form || !client ? (
        <p className="text-sm text-text-dim">Loading…</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate({
              status: form.status,
              monthlyAmount: form.monthlyAmount,
              paidUntil: toIso(form.paidUntil),
              trialEndDate: toIso(form.trialEndDate),
              tier: form.tier,
              billingDay: form.billingDay,
              nextDueDate: toIso(form.nextDueDate),
              notes: form.notes,
            })
          }}
        >
          {client.admins && client.admins.length > 0 && (
            <p className="text-xs text-text-dim">
              Admins: {client.admins.map((a) => `${a.name || a.email}${a.status === 'invited' ? ' (invited)' : ''}`).join(', ')}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onChange={(e) => set('status', e.target.value as WorkspaceStatusName)}>
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tier</Label>
              <Select value={form.tier ?? ''} onChange={(e) => set('tier', e.target.value || null)}>
                <option value="">—</option>
                {[...new Set([...TIERS, ...(form.tier ? [form.tier] : [])])].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
              <p className="text-[11px] text-text-muted">Picking a tier sets the monthly price unless you enter one.</p>
            </div>
            <div className="space-y-2">
              <Label>Monthly amount (₦)</Label>
              <Input
                type="number"
                min={0}
                value={form.monthlyAmount ?? ''}
                onChange={(e) => set('monthlyAmount', e.target.value === '' ? null : Math.round(Number(e.target.value)))}
              />
            </div>
            <div className="space-y-2">
              <Label>Billing day (1–28)</Label>
              <Input type="number" min={1} max={28} value={form.billingDay ?? ''} onChange={(e) => set('billingDay', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Paid until</Label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-44">
                  <Input type="date" value={form.paidUntil ?? ''} onChange={(e) => set('paidUntil', e.target.value || null)} />
                </div>
                {(['30d', '90d', '1y'] as const).map((x) => (
                  <Button key={x} type="button" size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ extendPaidUntil: x })}>
                    +{x}
                  </Button>
                ))}
                <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ paidUntil: null })}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Trial end</Label>
              <Input type="date" value={form.trialEndDate ?? ''} onChange={(e) => set('trialEndDate', e.target.value || null)} />
            </div>
            <div className="space-y-2">
              <Label>Next due</Label>
              <Input type="date" value={form.nextDueDate ?? ''} onChange={(e) => set('nextDueDate', e.target.value || null)} />
              <p className={cn('text-[11px]', client.overdue ? 'text-orange' : 'text-text-muted')}>
                {client.overdue ? `Past due — pauses on ${ymd(client.graceEndsAt)}` : 'Past due → paused after 7 days.'}
              </p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea rows={3} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" isLoading={save.isPending}>
              Save
            </Button>
          </div>

          <div className="rounded-xl border border-red/30 bg-red/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-red">Danger zone</p>
                <p className="text-xs text-text-dim">Permanently delete this workspace and all of its data. This can't be undone.</p>
              </div>
              {!dangerOpen && (
                <Button type="button" size="sm" variant="destructive" onClick={() => setDangerOpen(true)}>
                  <Trash2 size={14} /> Delete
                </Button>
              )}
            </div>
            {dangerOpen && (
              <div className="mt-3 space-y-2">
                <Label>
                  Type <span className="font-mono text-foreground">{client.name}</span> to confirm
                </Label>
                <div className="flex gap-2">
                  <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoFocus />
                  <Button type="button" variant="destructive" disabled={confirmName !== client.name} isLoading={del.isPending} onClick={() => del.mutate()}>
                    Delete forever
                  </Button>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setDangerOpen(false)} aria-label="Cancel delete">
                    <X size={16} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </form>
      )}
    </Modal>
  )
}

function NewClientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { isSuperAdmin } = usePermissions()
  const [form, setForm] = useState({ businessName: '', slug: '', adminName: '', adminEmail: '', monthlyAmount: '' })
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const autoSlug = useMemo(
    () =>
      form.businessName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48),
    [form.businessName]
  )
  const close = () => {
    setForm({ businessName: '', slug: '', adminName: '', adminEmail: '', monthlyAmount: '' })
    setInviteUrl(null)
    onClose()
  }
  const create = useMutation({
    mutationFn: () =>
      superAdminApi.newClient({
        businessName: form.businessName.trim(),
        slug: (form.slug || autoSlug) || undefined,
        adminName: form.adminName.trim(),
        adminEmail: form.adminEmail.trim(),
        monthlyAmount: isSuperAdmin && form.monthlyAmount ? Math.round(Number(form.monthlyAmount)) : undefined,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['super-admin'] })
      if (r.admin?.inviteUrl && !r.admin.emailSent) {
        setInviteUrl(r.admin.inviteUrl)
        toast.success(`${r.name} created`)
      } else {
        toast.success(`${r.name} created — invite emailed to the admin`)
        close()
      }
    },
    onError: (e) => toast.error(apiError(e).message),
  })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <Modal isOpen={open} onClose={close} title="New client" description="Creates the workspace and emails an invite to its admin.">
      {inviteUrl ? (
        <div className="space-y-3">
          <p className="text-sm text-orange">The invite email couldn't be sent. Share this link with the admin:</p>
          <div className="flex gap-2">
            <Input readOnly value={inviteUrl} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button variant="outline" onClick={async () => ((await copyText(inviteUrl)) ? toast.success('Copied') : toast.error('Copy failed'))}>
              <Copy size={14} />
            </Button>
          </div>
          <div className="flex justify-end">
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (form.businessName.trim().length < 2) return toast.error('Enter the business name.')
            if (!form.adminName.trim()) return toast.error("Enter the admin's name.")
            if (!/^\S+@\S+\.\S+$/.test(form.adminEmail.trim())) return toast.error('Enter a valid admin email.')
            create.mutate()
          }}
        >
          <div className="space-y-2">
            <Label>Business name</Label>
            <Input value={form.businessName} onChange={set('businessName')} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input value={form.slug} onChange={set('slug')} placeholder={autoSlug || 'auto'} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Admin name</Label>
              <Input value={form.adminName} onChange={set('adminName')} />
            </div>
            <div className="space-y-2">
              <Label>Admin email</Label>
              <Input type="email" value={form.adminEmail} onChange={set('adminEmail')} />
            </div>
          </div>
          {isSuperAdmin && (
            <div className="space-y-2">
              <Label>Monthly (₦)</Label>
              <Input type="number" min={0} value={form.monthlyAmount} onChange={set('monthlyAmount')} />
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" isLoading={create.isPending}>
              Create client
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

// ─── Client setup team ──────────────────────────────────────────────────────

function TeamTab() {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const { data: team = [], isLoading } = useQuery({ queryKey: ['super-admin', 'team'], queryFn: superAdminApi.team })
  const grant = useMutation({
    mutationFn: () => superAdminApi.grant(email.trim()),
    onSuccess: () => {
      toast.success(`${email.trim()} added to the client setup team`)
      setEmail('')
      qc.invalidateQueries({ queryKey: ['super-admin', 'team'] })
    },
    onError: (e) => toast.error(apiError(e).message),
  })
  const revoke = useMutation({
    mutationFn: superAdminApi.revoke,
    onSuccess: () => {
      toast.success('Removed from the client setup team')
      qc.invalidateQueries({ queryKey: ['super-admin', 'team'] })
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground">Client setup team</h2>
        <p className="text-sm text-text-dim">Client setup staff can create client workspaces but never see money figures.</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (/^\S+@\S+\.\S+$/.test(email.trim())) grant.mutate()
          else toast.error('Enter a valid email address.')
        }}
      >
        <Input type="email" placeholder="Email of an existing user" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" isLoading={grant.isPending}>
          <UserPlus size={15} /> Grant
        </Button>
      </form>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {isLoading && <p className="p-4 text-sm text-text-dim">Loading…</p>}
        {team.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-0">
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">{m.name || m.email}</p>
              <p className="truncate text-xs text-text-muted">{m.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <Chip className={m.platformRole === 'SUPER_ADMIN' ? 'border-gold/30 bg-gold/10 text-gold' : 'border-blue/30 bg-blue/10 text-blue'}>
                {m.platformRole === 'SUPER_ADMIN' ? 'Super admin' : 'Client setup'}
              </Chip>
              {m.platformRole === 'CLIENT_SETUP' && (
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(m.email)} disabled={revoke.isPending}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Auto-debit overview ────────────────────────────────────────────────────

function AutoDebitTab() {
  const { data, isLoading } = useQuery({ queryKey: ['super-admin', 'auto-debit'], queryFn: superAdminApi.autoDebit })
  if (isLoading || !data) return <p className="text-sm text-text-dim">Loading…</p>
  const s = data.summary
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Kpi label="Subscriptions" value={s.subscriptions} />
        <Kpi label="Active mandates" value={s.activeMandates} />
        <Kpi label="Pending mandates" value={s.pendingMandates} />
        <Kpi label="Settled charges" value={s.settledCharges} />
        <Kpi label="Gross" value={naira(s.gross)} />
        <Kpi label="Fees" value={naira(s.fees)} />
        <Kpi label="Net" value={naira(s.net)} />
      </div>

      <AdminTable
        title="Subscriptions"
        empty="No client subscriptions yet."
        head={['Workspace', 'Customer', 'Plan', 'Amount', 'Interval', 'Status', 'Mandate', 'Next run']}
        rows={data.subscriptions.map((x) => [
          x.workspace.name,
          x.customer?.name ?? '—',
          x.planName,
          x.amount != null ? naira(x.amount) : '—',
          x.interval.toLowerCase(),
          <Chip key="s" className="border-border bg-surface2 text-text-dim">
            {x.status.replace(/_/g, ' ')}
          </Chip>,
          x.cardLast4 ? `Card •••• ${x.cardLast4}` : x.mandateType ? x.mandateType.replace(/_/g, ' ').toLowerCase() : '—',
          ymd(x.nextRunAt),
        ])}
      />
      <AdminTable
        title="Active mandates"
        empty="No active mandates."
        head={['Workspace', 'Customer', 'Plan', 'Type', 'Reference', 'Authorised']}
        rows={data.mandates.map((x) => [
          x.workspace.name,
          x.customer?.name ?? '—',
          x.planName,
          x.cardLast4 ? `Card •••• ${x.cardLast4}` : (x.mandateType ?? '—').replace(/_/g, ' ').toLowerCase(),
          <span key="r" className="font-mono text-xs">
            {x.mandateReference ?? '—'}
          </span>,
          ymd(x.authorisedAt),
        ])}
      />
      <AdminTable
        title="Monnify settlements"
        empty="No settled charges yet."
        head={['Settled', 'Workspace', 'Customer', 'Plan', 'Reference', 'Gross', 'Fee', 'Net']}
        rows={data.settlements.map((x) => [
          ymd(x.settledAt),
          x.workspace.name,
          x.customer?.name ?? '—',
          x.planName,
          <span key="r" className="font-mono text-xs">
            {x.reference}
          </span>,
          naira(x.gross ?? 0),
          naira(x.fee ?? 0),
          naira(x.net ?? 0),
        ])}
      />
    </div>
  )
}

function AdminTable({ title, head, rows, empty }: { title: string; head: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-bold text-foreground">{title}</h3>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted">
              {head.map((h) => (
                <th key={h} className="px-4 py-2.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={head.length} className="px-4 py-6 text-center text-text-dim">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {r.map((c, j) => (
                    <td key={j} className="px-4 py-2.5 tabular-nums text-foreground">
                      {c}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
