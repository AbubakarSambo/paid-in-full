import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  ListChecks,
  Layers,
  FileSpreadsheet,
  Building2,
  PiggyBank,
  Receipt,
  Users,
  BarChart3,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/queue', label: 'Queue', icon: ListChecks },
  { to: '/batches', label: 'Batches', icon: Layers },
  { to: '/requisitions', label: 'Requisitions', icon: FileSpreadsheet },
  { to: '/vendors', label: 'Vendors', icon: Building2 },
  { to: '/budgets', label: 'Budgets', icon: PiggyBank },
  { to: '/invoices', label: 'Invoices', icon: Receipt },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  return (
    <aside className="hidden md:flex md:w-60 md:flex-col border-r border-border bg-surface">
      <div className="flex h-16 items-center gap-2 px-6 border-b border-border">
        <div className="h-8 w-8 rounded-lg bg-gold flex items-center justify-center text-primary-foreground font-black">
          ₦
        </div>
        <span className="font-display font-bold text-foreground tracking-tight">Paid in Full</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-gold/15 text-gold'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )
            }
          >
            <Icon size={18} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
