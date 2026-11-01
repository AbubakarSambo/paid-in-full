import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { usePermissions } from '@/lib/permissions'
import { useWorkspaceConfig } from './hooks'

export function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-surface3 border-t-gold" />
    </div>
  )
}

/** Signed-in only (waits for the persisted store to hydrate). */
export function RequireSession() {
  const token = useAuthStore((s) => s.token)
  const hydrated = useAuthStore((s) => s._hasHydrated)
  const location = useLocation()
  if (!hydrated) return null
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />
  return <Outlet />
}

/** `/` → /app (or /super-admin for platform staff without a workspace) when signed in, else /login. */
export function RootRedirect() {
  const token = useAuthStore((s) => s.token)
  const hydrated = useAuthStore((s) => s._hasHydrated)
  const workspace = useAuthStore((s) => s.workspace)
  const platformRole = useAuthStore((s) => s.platformRole)
  const needsOnboarding = useAuthStore((s) => s.needsOnboarding)
  if (!hydrated) return null
  if (!token) return <Navigate to="/login" replace />
  if (!workspace && platformRole) return <Navigate to="/super-admin" replace />
  if (needsOnboarding) return <Navigate to="/onboarding" replace />
  return <Navigate to="/app/queue" replace />
}

/** Platform roles only (SUPER_ADMIN / CLIENT_SETUP). */
export function RequirePlatform({ children }: { children: ReactNode }) {
  const { isPlatformStaff } = usePermissions()
  if (!isPlatformStaff) return <Navigate to="/app/queue" replace />
  return <>{children}</>
}

/** Hidden tabs redirect to the Queue when opened by URL. */
export function TabGate({ tab, children }: { tab: 'requisitions' | 'invoices'; children: ReactNode }) {
  const { canInvoice } = usePermissions()
  const { data: ws, isLoading } = useWorkspaceConfig()
  if (tab === 'invoices' && !canInvoice) return <Navigate to="/app/queue" replace />
  if (tab === 'requisitions') {
    if (isLoading) return <PageLoader />
    if (ws?.settings?.requisitionsEnabled === false) return <Navigate to="/app/queue" replace />
  }
  return <>{children}</>
}
