import { useQuery } from '@tanstack/react-query'
import { LogOut, Wallet } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { walletApi } from '@/lib/api'
import { formatCurrency, getInitials } from '@/lib/utils'
import { useNavigate } from 'react-router-dom'

export function Topbar() {
  const { user, workspace, logout } = useAuthStore()
  const navigate = useNavigate()

  const { data: wallet } = useQuery({
    queryKey: ['wallet', 'balance'],
    queryFn: walletApi.balance,
    staleTime: 60_000,
  })

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-4 md:px-8">
      <div>
        <p className="text-xs text-muted-foreground">Workspace</p>
        <p className="text-sm font-semibold text-foreground">{workspace?.name ?? '—'}</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="hidden sm:flex items-center gap-2 rounded-xl border border-border bg-secondary px-3 py-2 text-sm">
          <Wallet size={16} className="text-gold" />
          <span className="font-semibold text-foreground">
            {wallet ? formatCurrency(wallet.balance) : '—'}
          </span>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/15 text-sm font-bold text-gold">
          {getInitials(user?.firstName, user?.lastName)}
        </div>
        <button
          onClick={() => {
            logout()
            navigate('/login')
          }}
          className="text-muted-foreground hover:text-destructive transition-colors"
          aria-label="Log out"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  )
}
