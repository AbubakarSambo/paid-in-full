import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { queryClient } from '@/lib/queryClient'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AppShell } from '@/components/layout/AppShell'
import { PageLoader, RequirePlatform, RequireSession, RootRedirect, TabGate } from '@/components/layout/guards'
import { useShellUi } from '@/components/layout/shellStore'

// Public / auth
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const SetPasswordPage = lazy(() => import('@/pages/auth/SetPasswordPage'))
const VerifyEmailPage = lazy(() => import('@/pages/auth/VerifyEmailPage'))
const PublicInvoicePage = lazy(() => import('@/pages/public/PublicInvoicePage'))
const MandatePage = lazy(() => import('@/pages/public/MandatePage'))
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage'))
const SuperAdminPage = lazy(() => import('@/pages/SuperAdminPage'))

// /app tabs (spec §2 order)
const RequisitionsPage = lazy(() => import('@/pages/RequisitionsPage'))
const QueuePage = lazy(() => import('@/pages/QueuePage'))
const BatchesPage = lazy(() => import('@/pages/BatchesPage'))
const VendorsPage = lazy(() => import('@/pages/VendorsPage'))
const StockPage = lazy(() => import('@/pages/StockPage'))
const ReportsPage = lazy(() => import('@/pages/ReportsPage'))
const BudgetsPage = lazy(() => import('@/pages/BudgetsPage'))
const InvoicesPage = lazy(() => import('@/pages/InvoicesPage'))
const UsersPage = lazy(() => import('@/pages/UsersPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))

/** Old flat URLs (/queue, /batches/:id…) → /app/<tab>. */
function LegacyRedirect({ to }: { to: string }) {
  return <Navigate to={to} replace />
}
function LegacyBatchRedirect() {
  const { id } = useParams()
  return <Navigate to={`/app/batches${id ? `?batch=${id}` : ''}`} replace />
}

function ThemedToaster() {
  const theme = useShellUi((s) => s.theme)
  return <Toaster richColors position="top-right" theme={theme} closeButton />
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<RootRedirect />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<Navigate to="/login?mode=signup" replace />} />
              <Route path="/set-password" element={<SetPasswordPage mode="invite" />} />
              <Route path="/reset-password" element={<SetPasswordPage mode="reset" />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/i/:token" element={<PublicInvoicePage />} />
              <Route path="/m/:token" element={<MandatePage />} />

              <Route element={<RequireSession />}>
                <Route path="/onboarding" element={<OnboardingPage />} />
                <Route
                  path="/super-admin"
                  element={
                    <RequirePlatform>
                      <SuperAdminPage />
                    </RequirePlatform>
                  }
                />
                <Route path="/app" element={<AppShell />}>
                  <Route index element={<Navigate to="queue" replace />} />
                  <Route
                    path="requisitions"
                    element={
                      <TabGate tab="requisitions">
                        <RequisitionsPage />
                      </TabGate>
                    }
                  />
                  <Route path="queue" element={<QueuePage />} />
                  <Route path="batches" element={<BatchesPage />} />
                  <Route path="vendors" element={<VendorsPage />} />
                  <Route path="stock" element={<StockPage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="budgets" element={<BudgetsPage />} />
                  <Route
                    path="invoices"
                    element={
                      <TabGate tab="invoices">
                        <InvoicesPage />
                      </TabGate>
                    }
                  />
                  <Route path="users" element={<UsersPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="queue" replace />} />
                </Route>
              </Route>

              {/* Legacy flat routes from the first port */}
              <Route path="/dashboard" element={<LegacyRedirect to="/app/queue" />} />
              <Route path="/customers" element={<LegacyRedirect to="/app/invoices" />} />
              <Route path="/batches/:id" element={<LegacyBatchRedirect />} />
              <Route path="/settings/*" element={<LegacyRedirect to="/app/settings" />} />
              {['queue', 'batches', 'requisitions', 'vendors', 'stock', 'reports', 'budgets', 'invoices', 'users'].map((t) => (
                <Route key={t} path={`/${t}`} element={<LegacyRedirect to={`/app/${t}`} />} />
              ))}

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <ThemedToaster />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
