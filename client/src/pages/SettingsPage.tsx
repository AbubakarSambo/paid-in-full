import { Component, useEffect, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { usePermissions, type Capabilities } from '@/lib/permissions'

import Profile from './settings/sections/Profile'
import Appearance from './settings/sections/Appearance'
import Modules from './settings/sections/Modules'
import Workspace from './settings/sections/Workspace'
import BusinessUnits from './settings/sections/BusinessUnits'
import Users from './settings/sections/Users'
import WalletAccount from './settings/sections/WalletAccount'
import InvoicePaymentAccount from './settings/sections/InvoicePaymentAccount'
import WhtAccount from './settings/sections/WhtAccount'
import WhtRates from './settings/sections/WhtRates'
import SheetsBatches from './settings/sections/SheetsBatches'
import SheetsInvoices from './settings/sections/SheetsInvoices'
import AutoSweep from './settings/sections/AutoSweep'
import PaymentCategories from './settings/sections/PaymentCategories'
import CoaTags from './settings/sections/CoaTags'
import DisbursementPin from './settings/sections/DisbursementPin'
import WalletHealth from './settings/sections/WalletHealth'
import TopUpHistory from './settings/sections/TopUpHistory'
import Subscription from './settings/sections/Subscription'
import ClientSubscriptions from './settings/sections/ClientSubscriptions'
import ClientMandates from './settings/sections/ClientMandates'
import SheetRecon from './settings/sections/SheetRecon'
import Notifications from './settings/sections/Notifications'
import Security from './settings/sections/Security'
import AuditLog from './settings/sections/AuditLog'
import InvoiceBranding from './settings/sections/InvoiceBranding'
import WalletLedger from './settings/sections/WalletLedger'

interface SectionDef {
  id: string
  label: string
  Comp: ComponentType
  show?: (c: Capabilities) => boolean
}

const invoicing = (c: Capabilities) => c.canInvoice

/** Spec §5.10 order, top to bottom. */
const SECTIONS: SectionDef[] = [
  { id: 'profile', label: 'Your profile', Comp: Profile },
  { id: 'appearance', label: 'Appearance', Comp: Appearance },
  { id: 'modules', label: 'Modules', Comp: Modules },
  { id: 'workspace', label: 'Workspace', Comp: Workspace },
  { id: 'business-units', label: 'Business Units', Comp: BusinessUnits },
  { id: 'team', label: 'Team', Comp: Users },
  { id: 'wallet-account', label: 'Wallet account', Comp: WalletAccount },
  { id: 'invoice-payment-account', label: 'Invoice payment account', Comp: InvoicePaymentAccount, show: invoicing },
  { id: 'wht-account', label: 'WHT account', Comp: WhtAccount },
  { id: 'wht-rates', label: 'WHT rates', Comp: WhtRates },
  { id: 'sheets-batches', label: 'Sheets — Batches', Comp: SheetsBatches },
  { id: 'sheets-invoices', label: 'Sheets — Invoices', Comp: SheetsInvoices, show: invoicing },
  { id: 'auto-sweep', label: 'Auto-sweep', Comp: AutoSweep, show: invoicing },
  { id: 'payment-categories', label: 'Payment categories', Comp: PaymentCategories },
  { id: 'coa-tags', label: 'COA tags', Comp: CoaTags },
  { id: 'disbursement-pin', label: 'Disbursement PIN', Comp: DisbursementPin },
  { id: 'wallet-health', label: 'Wallet health', Comp: WalletHealth },
  { id: 'top-up-history', label: 'Top-up history', Comp: TopUpHistory },
  { id: 'subscription', label: 'Subscription', Comp: Subscription },
  { id: 'client-subscriptions', label: 'Client subscriptions', Comp: ClientSubscriptions, show: invoicing },
  { id: 'client-mandates', label: 'Client mandates', Comp: ClientMandates, show: invoicing },
  { id: 'sheet-recon', label: 'Sheet recon', Comp: SheetRecon },
  { id: 'notifications', label: 'Notifications', Comp: Notifications },
  { id: 'security', label: 'Security', Comp: Security },
  { id: 'audit-log', label: 'Audit log', Comp: AuditLog, show: (c) => c.isAdmin },
  { id: 'invoice-branding', label: 'Invoice branding', Comp: InvoiceBranding, show: invoicing },
  { id: 'wallet-ledger', label: 'Wallet ledger', Comp: WalletLedger },
]

/** One failing section shouldn't take the whole page down. */
class SectionBoundary extends Component<{ label: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Settings section "${this.props.label}" crashed`, error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border border-red/30 bg-red/5 p-5 text-sm text-red">
          {this.props.label} couldn't load. Refresh the page to try again.
        </div>
      )
    }
    return this.props.children
  }
}

export default function SettingsPage() {
  const caps = usePermissions()
  const location = useLocation()
  const visible = SECTIONS.filter((s) => !s.show || s.show(caps))

  // Deep links like /app/settings#wallet-health.
  useEffect(() => {
    const id = location.hash.replace('#', '')
    if (!id) return
    const t = window.setTimeout(() => document.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
    return () => window.clearTimeout(t)
  }, [location.hash])

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <nav className="sticky top-32 max-h-[calc(100vh-9rem)] space-y-0.5 overflow-y-auto pr-2">
          <p className="mb-2 px-2 text-[11px] font-bold uppercase tracking-wider text-text-muted">Settings</p>
          {visible.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`block rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-surface2 hover:text-foreground ${
                location.hash === `#${s.id}` ? 'bg-surface2 text-foreground' : 'text-text-dim'
              }`}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-text-dim">Your profile, workspace, money movement and integrations.</p>
        </div>
        {visible.map(({ id, label, Comp }) => (
          <div key={id} data-section={id} className="scroll-mt-32">
            <SectionBoundary label={label}>
              <Comp />
            </SectionBoundary>
          </div>
        ))}
      </div>
    </div>
  )
}
