import { Suspense, useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { authApi } from '@/lib/api/shell'
import { Header } from './Header'
import { TabBar } from './TabBar'
import { IdleTimeout } from './IdleTimeout'
import { ProductTour, WhatsNewModal } from './TourAndWhatsNew'
import { OnboardingChecklist } from './OnboardingChecklist'
import { applySkin } from './shellStore'
import { PageLoader } from './guards'

/** Authenticated /app frame: header, horizontal tabs, global behaviours (spec §2). */
export function AppShell() {
  const user = useAuthStore((s) => s.user)
  const workspace = useAuthStore((s) => s.workspace)
  const needsOnboarding = useAuthStore((s) => s.needsOnboarding)
  const setSession = useAuthStore((s) => s.setSession)
  const location = useLocation()

  // Refresh the session once per workspace so role/biller/workspaces stay current.
  const { data: session } = useQuery({
    queryKey: ['auth', 'session', workspace?.id],
    queryFn: authApi.session,
    staleTime: 5 * 60_000,
    retry: false,
  })
  useEffect(() => {
    if (session) setSession(session)
  }, [session, setSession])

  useEffect(() => applySkin(user?.accentSkin as string | null | undefined), [user?.accentSkin])

  if (!workspace) {
    return user?.platformRole ? <Navigate to="/super-admin" replace /> : <Navigate to="/login" replace />
  }
  if (needsOnboarding) return <Navigate to="/onboarding" replace />

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <TabBar />
      <main className="mx-auto max-w-[1400px] px-4 py-5 md:px-6 md:py-6">
        <OnboardingChecklist />
        <Suspense fallback={<PageLoader />}>
          <Outlet key={location.pathname.split('/')[2]} />
        </Suspense>
      </main>
      <IdleTimeout />
      <ProductTour />
      <WhatsNewModal />
    </div>
  )
}
