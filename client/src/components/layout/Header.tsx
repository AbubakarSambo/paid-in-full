import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Bell,
  Check,
  ChevronDown,
  Copy,
  LogOut,
  Moon,
  MoreVertical,
  Plus,
  RefreshCw,
  Repeat,
  Shield,
  Sun,
  Sparkles,
  UserRound,
  Wallet,
  Compass,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { usePermissions } from '@/lib/permissions'
import { activityApi, apiError, authApi, walletShellApi } from '@/lib/api/shell'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dropdown, MenuItem } from './Dropdown'
import { useSheetsStatus, useWalletSummary, useWorkspaceConfig, num } from './hooks'
import { copyText, naira, timeAgo, useShellUi, userFlag } from './shellStore'

/** Spec §2 tagline list, picked at random per page load. */
export const TAGLINES = [
  'Built Different',
  "Keepin' It Paid",
  'Money Moves Only',
  'Stay Liquid',
  'Run The Bag',
  'Cash Flow King',
  'Paid On Time',
  'No Loose Ends',
  'Clean Books Club',
  'Vendors Love Us',
]

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold font-display text-lg font-black text-primary-foreground', className)}>
      ₦
    </div>
  )
}

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-2 px-4 sm:gap-3 md:px-6">
        <WorkspaceSwitcher />
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <WalletPill />
          <ActivityBell />
          <TopUpButton />
          <OverflowMenu />
        </div>
      </div>
    </header>
  )
}

// ─── Workspace switcher ─────────────────────────────────────────────────────

function WorkspaceSwitcher() {
  const { user, workspace, workspaces, switchWorkspace, logout } = useAuthStore()
  const navigate = useNavigate()
  const tagline = useMemo(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)], [])
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')

  const switchMut = useMutation({
    mutationFn: authApi.switchWorkspace,
    onSuccess: (s) => {
      switchWorkspace(s)
      toast.success(`Switched to ${s.workspace?.name}`)
      navigate(s.needsOnboarding ? '/onboarding' : '/app/queue')
    },
    onError: (e) => toast.error(apiError(e).message),
  })
  const createMut = useMutation({
    mutationFn: () => authApi.createWorkspace(name.trim()),
    onSuccess: (s) => {
      switchWorkspace(s)
      setCreateOpen(false)
      setName('')
      toast.success(`Workspace “${s.workspace?.name}” created`)
      navigate(s.needsOnboarding ? '/onboarding' : '/app/queue')
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  return (
    <>
      <Dropdown
        align="left"
        className="w-72"
        trigger={(open) => (
          <button type="button" className="flex min-w-0 items-center gap-2.5 rounded-xl px-1 py-1 text-left hover:bg-surface2">
            {workspace?.logoUrl ? (
              <img src={workspace.logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-xl object-cover" />
            ) : (
              <Logo />
            )}
            <div className="hidden min-w-0 sm:block">
              <div className="flex items-center gap-1">
                <span className="truncate font-display text-sm font-bold text-foreground max-w-[180px]">{workspace?.name ?? 'Paid in Full'}</span>
                <ChevronDown size={14} className={cn('text-text-dim transition-transform', open && 'rotate-180')} />
              </div>
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-gold">{tagline}</p>
            </div>
            <ChevronDown size={14} className="text-text-dim sm:hidden" />
          </button>
        )}
      >
        {(close) => (
          <div>
            <div className="px-3 pb-2 pt-1.5">
              <p className="text-[11px] uppercase tracking-wider text-text-muted">Signed in as</p>
              <p className="truncate text-sm font-semibold text-foreground">{user?.email}</p>
            </div>
            <div className="my-1 border-t border-border" />
            <div className="max-h-64 overflow-y-auto">
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  disabled={switchMut.isPending}
                  onClick={() => {
                    close()
                    if (w.id !== workspace?.id) switchMut.mutate(w.id)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface3"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface3 text-[11px] font-bold text-text-dim">
                    {w.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">{w.name}</span>
                    <span className="block text-[11px] text-text-muted">
                      {w.role ? w.role.toLowerCase() : 'member'}
                      {w.invited ? ' · invited' : ''}
                    </span>
                  </span>
                  {w.id === workspace?.id && <Check size={16} className="text-gold" />}
                </button>
              ))}
            </div>
            <div className="my-1 border-t border-border" />
            <MenuItem
              icon={<Plus size={15} />}
              onClick={() => {
                close()
                setCreateOpen(true)
              }}
            >
              Create new workspace
            </MenuItem>
            <MenuItem
              icon={<UserRound size={15} />}
              onClick={() => {
                close()
                logout()
                navigate('/login')
              }}
            >
              Switch account
            </MenuItem>
          </div>
        )}
      </Dropdown>

      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="Create new workspace" description="You'll be the admin of the new workspace.">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim().length >= 2) createMut.mutate()
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="ws-name">Workspace name</Label>
            <Input id="ws-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Yellow Door Hotel" />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMut.isPending} disabled={name.trim().length < 2}>
              Create workspace
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

// ─── Wallet pill ────────────────────────────────────────────────────────────

const SYNC_DOT: Record<string, string> = {
  Synced: 'bg-green',
  Syncing: 'bg-blue animate-pulse',
  Error: 'bg-red',
  'Not synced': 'bg-text-muted',
}

function WalletPill() {
  const navigate = useNavigate()
  const { data: wallet, isLoading } = useWalletSummary()
  const { data: sheets } = useSheetsStatus()
  const ready = wallet ? num(wallet.readyToSend ?? wallet.balance) : null
  const syncLabel = sheets?.status ?? 'Not synced'

  return (
    <button
      type="button"
      onClick={() => navigate('/app/settings#wallet-health')}
      title={sheets?.lastError ?? sheets?.lastMessage ?? `Sheets: ${syncLabel}`}
      className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 hover:border-gold/40"
    >
      <Wallet size={15} className="hidden text-gold sm:block" />
      <div className="text-left leading-tight">
        <div className="hidden items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim md:flex">
          Ready to send <span className="text-text-muted">·</span>
          <span className={cn('inline-block h-1.5 w-1.5 rounded-full', SYNC_DOT[syncLabel] ?? 'bg-text-muted')} />
          {syncLabel}
        </div>
        <div className="font-display text-sm font-bold tabular-nums text-foreground">{isLoading ? '…' : ready === null ? '—' : naira(ready)}</div>
      </div>
    </button>
  )
}

// ─── Bell / Recent Activity ─────────────────────────────────────────────────

function ActivityBell() {
  const userId = useAuthStore((s) => s.user?.id)
  const workspaceId = useAuthStore((s) => s.workspace?.id)
  const [lastSeen, setLastSeen] = useState(() => userFlag.get(userId, 'activity-seen') ?? '')
  const { data: feed = [], isLoading } = useQuery({
    queryKey: ['activity', 'feed'],
    queryFn: () => activityApi.feed(30),
    enabled: !!workspaceId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const unread = feed.filter((a) => !a.isMine && (!lastSeen || a.createdAt > lastSeen)).length

  return (
    <Dropdown
      className="w-[22rem]"
      onOpenChange={(open) => {
        if (open && feed[0]) {
          userFlag.set(userId, 'activity-seen', feed[0].createdAt)
          setLastSeen(feed[0].createdAt)
        }
      }}
      trigger={() => (
        <button type="button" aria-label="Recent activity" className="relative flex h-9 w-9 items-center justify-center rounded-full text-text-dim hover:bg-surface2 hover:text-foreground">
          <Bell size={18} />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red px-1 text-[10px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}
    >
      {() => (
        <div>
          <p className="px-3 pb-2 pt-1.5 text-[11px] font-bold uppercase tracking-wider text-text-dim">Recent activity</p>
          <div className="max-h-96 overflow-y-auto">
            {isLoading && <p className="px-3 py-6 text-center text-sm text-text-dim">Loading…</p>}
            {!isLoading && feed.length === 0 && <p className="px-3 py-6 text-center text-sm text-text-dim">Nothing yet. Activity in this workspace shows up here.</p>}
            {feed.map((a) => (
              <div key={a.id} className="rounded-lg px-3 py-2 hover:bg-surface3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{a.title}</p>
                  <span className="shrink-0 text-[11px] text-text-muted">{timeAgo(a.createdAt)}</span>
                </div>
                {a.summary && <p className="truncate text-xs text-text-dim">{a.summary}</p>}
                <p className="text-[11px] text-text-muted">{a.isMine ? 'You' : a.actorName}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Dropdown>
  )
}

// ─── Top up ─────────────────────────────────────────────────────────────────

function TopUpButton() {
  const { topUpOpen, setTopUpOpen } = useShellUi()
  return (
    <>
      <Button size="sm" className="rounded-full px-3 sm:px-4" onClick={() => setTopUpOpen(true)}>
        <Plus size={14} />
        <span className="hidden sm:inline">Top Up</span>
      </Button>
      <TopUpDialog open={topUpOpen} onClose={() => setTopUpOpen(false)} />
    </>
  )
}

function TopUpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { data: wallet } = useWalletSummary()
  const { data: ws } = useWorkspaceConfig()
  const { isAdmin, canPay } = usePermissions()
  const qc = useQueryClient()
  const [simAmount, setSimAmount] = useState('50000')
  const simulate = useMutation({
    mutationFn: () => walletShellApi.simulateTopup(Number(simAmount)),
    onSuccess: () => {
      toast.success('Simulated payment sent — your balance updates in a few seconds')
      // The mock webhook fires ~4s after the request.
      setTimeout(() => qc.invalidateQueries({ queryKey: ['wallet'] }), 5000)
      onClose()
    },
    onError: (e) => toast.error(apiError(e).message),
  })
  const account =
    wallet?.account ??
    (ws?.monnifyReservedAccountNumber
      ? { accountNumber: ws.monnifyReservedAccountNumber, accountName: ws.monnifyReservedAccountName, bankName: ws.monnifyReservedAccountBank }
      : null)

  return (
    <Modal isOpen={open} onClose={onClose} title="Top up your wallet" description="Send a bank transfer to your dedicated account. Funds show up automatically once Monnify confirms them.">
      {account ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface2 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-text-dim">Account number</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="font-display text-2xl font-bold tabular-nums tracking-wider text-foreground">{account.accountNumber}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  if (await copyText(account.accountNumber)) toast.success('Account number copied')
                  else toast.error('Copy failed. Select the number and copy it by hand.')
                }}
              >
                <Copy size={14} /> Copy
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-text-muted">Bank</p>
                <p className="text-foreground">{account.bankName ?? '—'}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-text-muted">Account name</p>
                <p className="text-foreground">{account.accountName ?? '—'}</p>
              </div>
            </div>
          </div>
          <p className="text-xs text-text-dim">Transfers usually land within a few minutes. If one is missing, use “Reconcile top-ups” in the ⋮ menu.</p>
          {wallet?.mockMode && canPay && (
            <div className="rounded-xl border border-dashed border-border p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-text-dim">Test mode</p>
              <p className="mt-1 text-xs text-text-dim">Monnify is in mock mode, so real transfers aren't detected. Simulate one instead.</p>
              <div className="mt-3 flex items-end gap-3">
                <div className="flex-1">
                  <Label htmlFor="sim-amount">Amount (₦)</Label>
                  <Input id="sim-amount" type="number" min={1} value={simAmount} onChange={(e) => setSimAmount(e.target.value)} />
                </div>
                <Button variant="outline" isLoading={simulate.isPending} disabled={!(Number(simAmount) > 0)} onClick={() => simulate.mutate()}>
                  Simulate payment
                </Button>
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-text-dim">This workspace doesn't have a wallet account yet. {isAdmin ? 'Provision or link one in Settings → Wallet Account.' : 'Ask an admin to set one up in Settings.'}</p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {isAdmin && (
              <Button
                onClick={() => {
                  onClose()
                  navigate('/app/settings#wallet-account')
                }}
              >
                Open wallet settings
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── ⋮ menu ─────────────────────────────────────────────────────────────────

function OverflowMenu() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const { canPay, isPlatformStaff } = usePermissions()
  const { theme, toggleTheme, setTourOpen, setWhatsNewOpen } = useShellUi()

  const reconcile = useMutation({
    mutationFn: walletShellApi.reconcileTopups,
    onSuccess: (r) => {
      toast.success(r?.message ?? 'Top-ups reconciled')
      qc.invalidateQueries({ queryKey: ['wallet'] })
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  return (
    <Dropdown
      trigger={() => (
        <button type="button" aria-label="More" className="flex h-9 w-9 items-center justify-center rounded-full text-text-dim hover:bg-surface2 hover:text-foreground">
          <MoreVertical size={18} />
        </button>
      )}
    >
      {(close) => (
        <div>
          <MenuItem
            icon={<RefreshCw size={15} />}
            onClick={() => {
              close()
              qc.invalidateQueries({ queryKey: ['wallet'] })
              qc.invalidateQueries({ queryKey: ['sheets', 'status'] })
              toast.success('Balance refreshed')
            }}
          >
            Refresh balance
          </MenuItem>
          {canPay && (
            <MenuItem
              icon={<Repeat size={15} />}
              disabled={reconcile.isPending}
              onClick={() => {
                close()
                reconcile.mutate()
              }}
            >
              Reconcile top-ups
            </MenuItem>
          )}
          <MenuItem
            icon={theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            onClick={() => {
              close()
              toggleTheme()
            }}
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </MenuItem>
          <MenuItem
            icon={<Compass size={15} />}
            onClick={() => {
              close()
              navigate('/app/queue')
              setTourOpen(true)
            }}
          >
            Replay tour
          </MenuItem>
          <MenuItem
            icon={<Sparkles size={15} />}
            onClick={() => {
              close()
              setWhatsNewOpen(true)
            }}
          >
            What's new
          </MenuItem>
          {isPlatformStaff && (
            <MenuItem
              icon={<Shield size={15} />}
              onClick={() => {
                close()
                navigate('/super-admin')
              }}
            >
              PIF console
            </MenuItem>
          )}
          <div className="my-1 border-t border-border" />
          <MenuItem
            danger
            icon={<LogOut size={15} />}
            onClick={() => {
              close()
              logout()
              navigate('/login')
            }}
          >
            Sign out
          </MenuItem>
        </div>
      )}
    </Dropdown>
  )
}
