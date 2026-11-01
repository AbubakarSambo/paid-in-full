import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { BarChart3, Building2, FileText, Layers, ListChecks, Package, PiggyBank, Receipt, Settings, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/lib/permissions'
import { useWorkspaceConfig } from './hooks'

export interface TabDef {
  path: string
  label: string
  icon: LucideIcon
  tour?: string
}

/** Spec §2 tab order. */
export const TABS: TabDef[] = [
  { path: 'requisitions', label: 'Requisitions', icon: FileText },
  { path: 'queue', label: 'Queue', icon: ListChecks, tour: 'queue' },
  { path: 'batches', label: 'Batches', icon: Layers, tour: 'batches' },
  { path: 'vendors', label: 'Vendors', icon: Building2, tour: 'vendors' },
  { path: 'stock', label: 'Stock', icon: Package },
  { path: 'reports', label: 'Reports', icon: BarChart3 },
  { path: 'budgets', label: 'Budgets', icon: PiggyBank },
  { path: 'invoices', label: 'Invoices', icon: Receipt },
  { path: 'users', label: 'Users', icon: Users, tour: 'users' },
  { path: 'settings', label: 'Settings', icon: Settings, tour: 'settings' },
]

/** Requisitions hidden when the module is off; Invoices hidden unless Biller/Admin. */
export function useVisibleTabs(): TabDef[] {
  const { data: ws } = useWorkspaceConfig()
  const { canInvoice } = usePermissions()
  const requisitionsEnabled = ws?.settings?.requisitionsEnabled !== false
  return TABS.filter((t) => (t.path === 'requisitions' ? requisitionsEnabled : t.path === 'invoices' ? canInvoice : true))
}

export function TabBar() {
  const tabs = useVisibleTabs()
  const location = useLocation()
  const scroller = useRef<HTMLDivElement>(null)

  // Keep the active tab in view on narrow screens.
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('[aria-current="page"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [location.pathname])

  return (
    <nav className="sticky top-16 z-20 border-b border-border bg-background/95 backdrop-blur">
      <div ref={scroller} className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-2 [scrollbar-width:none] md:px-4 [&::-webkit-scrollbar]:hidden">
        {tabs.map(({ path, label, icon: Icon, tour }) => (
          <NavLink
            key={path}
            to={`/app/${path}`}
            data-tour={tour}
            className={({ isActive }) =>
              cn(
                'relative flex shrink-0 items-center gap-2 px-3 py-3 text-sm font-semibold transition-colors',
                'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors',
                isActive ? 'text-foreground after:bg-gold' : 'text-text-dim after:bg-transparent hover:text-foreground'
              )
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
