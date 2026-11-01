import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePermissions } from '@/lib/permissions'
import { invoicesApi } from '@/lib/api/invoicing'
import type { Invoice } from '@/types/invoicing'
import { InvoicesTab } from '@/components/invoices/InvoicesTab'
import { InvoiceEditor } from '@/components/invoices/InvoiceEditor'
import { InvoiceDetail } from '@/components/invoices/InvoiceDetail'
import { CustomersTab } from '@/components/invoices/CustomersTab'
import { RecurringTab } from '@/components/invoices/RecurringTab'
import { ProductsTab } from '@/components/invoices/ProductsTab'
import { CreditsTab } from '@/components/invoices/CreditsTab'
import { Kpi, money } from '@/components/invoices/shared'
import { cn } from '@/lib/utils'

type Tab = 'invoices' | 'customers' | 'recurring' | 'products' | 'credits'
const TABS: { id: Tab; label: string }[] = [
  { id: 'invoices', label: 'Invoices' },
  { id: 'customers', label: 'Customers' },
  { id: 'recurring', label: 'Recurring' },
  { id: 'products', label: 'Products' },
  { id: 'credits', label: 'Credits' },
]

export default function InvoicesPage() {
  const { canInvoice } = usePermissions()
  const [tab, setTab] = useState<Tab>('invoices')
  const [editor, setEditor] = useState<{ open: boolean; invoice: Invoice | null }>({ open: false, invoice: null })
  const [detailId, setDetailId] = useState<string | null>(null)
  const { data: summary } = useQuery({ queryKey: ['invoice-summary'], queryFn: invoicesApi.summary, enabled: canInvoice })

  if (!canInvoice) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-sm text-text-dim">
        Invoicing is available to Billers and Admins. Ask an admin to grant you the Biller role.
      </div>
    )
  }

  const openDetail = (id: string) => {
    setTab('invoices')
    setDetailId(id)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Invoicing</h1>
        <p className="text-sm text-text-dim">Bill customers, track payments, automate recurring.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Paid this month" value={money(summary?.paidThisMonth)} tone="green" />
        <Kpi label="Outstanding" value={money(summary?.outstanding)} sub={summary ? `${summary.outstandingCount} open invoice(s)` : undefined} tone="gold" />
        <Kpi label="Overdue" value={money(summary?.overdue)} sub={summary ? `${summary.overdueCount} overdue` : undefined} tone="red" />
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                '-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
                tab === t.id ? 'border-gold text-gold' : 'border-transparent text-text-dim hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'invoices' && <InvoicesTab onOpen={setDetailId} onNew={() => setEditor({ open: true, invoice: null })} />}
      {tab === 'customers' && <CustomersTab />}
      {tab === 'recurring' && <RecurringTab onOpenInvoice={openDetail} />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'credits' && <CreditsTab />}

      <InvoiceEditor
        open={editor.open}
        invoice={editor.invoice}
        onClose={() => setEditor({ open: false, invoice: null })}
        onSaved={(inv) => {
          setEditor({ open: false, invoice: null })
          setDetailId(inv.id)
        }}
      />
      <InvoiceDetail
        invoiceId={editor.open ? null : detailId}
        onClose={() => setDetailId(null)}
        onEdit={(inv) => setEditor({ open: true, invoice: inv })}
        onOpenInvoice={setDetailId}
      />
    </div>
  )
}
