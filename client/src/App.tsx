import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { queryClient } from '@/lib/queryClient'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { RequireAuth } from '@/components/RequireAuth'
import { AppShell } from '@/components/layout/AppShell'

import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import DashboardPage from '@/pages/DashboardPage'
import QueuePage from '@/pages/QueuePage'
import BatchesPage from '@/pages/BatchesPage'
import BatchDetailPage from '@/pages/BatchDetailPage'
import RequisitionsPage from '@/pages/RequisitionsPage'
import VendorsPage from '@/pages/VendorsPage'
import BudgetsPage from '@/pages/BudgetsPage'
import InvoicesPage from '@/pages/InvoicesPage'
import CustomersPage from '@/pages/CustomersPage'
import ReportsPage from '@/pages/ReportsPage'
import SettingsPage from '@/pages/SettingsPage'
import WorkspaceSettings from '@/pages/settings/WorkspaceSettings'
import BillingSettings from '@/pages/settings/BillingSettings'
import TeamSettings from '@/pages/settings/TeamSettings'
import TaxSettings from '@/pages/settings/TaxSettings'
import NotificationSettings from '@/pages/settings/NotificationSettings'

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/queue" element={<QueuePage />} />
                <Route path="/batches" element={<BatchesPage />} />
                <Route path="/batches/:id" element={<BatchDetailPage />} />
                <Route path="/requisitions" element={<RequisitionsPage />} />
                <Route path="/vendors" element={<VendorsPage />} />
                <Route path="/budgets" element={<BudgetsPage />} />
                <Route path="/invoices" element={<InvoicesPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/settings" element={<SettingsPage />}>
                  <Route index element={<Navigate to="/settings/workspace" replace />} />
                  <Route path="workspace" element={<WorkspaceSettings />} />
                  <Route path="billing" element={<BillingSettings />} />
                  <Route path="team" element={<TeamSettings />} />
                  <Route path="tax" element={<TaxSettings />} />
                  <Route path="notifications" element={<NotificationSettings />} />
                </Route>
              </Route>
            </Route>

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="top-right" theme="dark" />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
