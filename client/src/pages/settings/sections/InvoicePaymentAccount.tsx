import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BadgeCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingsSection } from '@/components/shared/SettingsSection'
import { BankFields, bankValid } from '@/components/invoices/BankFields'
import { Chip, CopyButton, ReadOnlyNote, fmtDate } from '@/components/invoices/shared'
import { apiError, invoiceSettingsApi } from '@/lib/api/invoicing'
import { usePermissions } from '@/lib/permissions'

/** Settings §6: the revenue account printed on invoices (verified by bank name enquiry). */
export default function InvoicePaymentAccount() {
  const qc = useQueryClient()
  const { canInvoice } = usePermissions()
  const { data: settings, isLoading } = useQuery({ queryKey: ['invoice-settings'], queryFn: invoiceSettingsApi.get, enabled: canInvoice })
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ bankCode: '', accountNumber: '' })
  const acct = settings?.paymentAccount ?? null

  const save = useMutation({
    mutationFn: () => invoiceSettingsApi.setPaymentAccount(form),
    onSuccess: (a) => {
      toast.success(`Verified: ${a.accountName}`)
      qc.invalidateQueries({ queryKey: ['invoice-settings'] })
      setEditing(false)
    },
    onError: (e) => toast.error(apiError(e, 'Could not verify that account')),
  })
  const clear = useMutation({
    mutationFn: invoiceSettingsApi.clearPaymentAccount,
    onSuccess: () => {
      toast.success('Payment account removed')
      qc.invalidateQueries({ queryKey: ['invoice-settings'] })
    },
    onError: (e) => toast.error(apiError(e)),
  })

  return (
    <SettingsSection
      id="invoice-payment-account"
      title="Invoice payment account"
      description="The revenue account printed on invoices when an invoice has no dedicated collection account."
    >
      {!canInvoice ? (
        <ReadOnlyNote>Read-only — Biller or Admin role required.</ReadOnlyNote>
      ) : isLoading ? (
        <p className="text-sm text-text-dim">Loading…</p>
      ) : editing || !acct ? (
        <div className="space-y-3">
          <BankFields bankCode={form.bankCode} accountNumber={form.accountNumber} onChange={setForm} />
          <div className="flex justify-end gap-2">
            {acct && (
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            <Button size="sm" disabled={!bankValid(form.bankCode, form.accountNumber)} isLoading={save.isPending} onClick={() => save.mutate()}>
              Verify &amp; save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface2/50 p-4">
          <div>
            <div className="flex items-center gap-1 text-lg font-bold tabular-nums">
              {acct.accountNumber} <CopyButton text={acct.accountNumber} />
            </div>
            <div className="text-sm">{acct.accountName}</div>
            <div className="text-xs text-text-dim">{acct.bankName ?? acct.bankCode}</div>
            <div className="mt-1 flex items-center gap-2">
              <Chip tone="green">
                <BadgeCheck size={11} className="mr-1" /> Verified
              </Chip>
              {acct.verifiedAt && <span className="text-xs text-text-muted">{fmtDate(acct.verifiedAt)}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setForm({ bankCode: acct.bankCode, accountNumber: acct.accountNumber })
                setEditing(true)
              }}
            >
              Change
            </Button>
            <Button size="sm" variant="outline" isLoading={clear.isPending} onClick={() => clear.mutate()}>
              Remove
            </Button>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}
