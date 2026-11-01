import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminOnlyNote, SettingsSection } from '@/components/shared/SettingsSection'
import { BankFields, bankValid } from '@/components/invoices/BankFields'
import { Field, Toggle, money } from '@/components/invoices/shared'
import { apiError, invoiceSettingsApi } from '@/lib/api/invoicing'
import { usePermissions } from '@/lib/permissions'

/** Settings §11: Invoice collections auto-sweep (admin only, enforced by the API too). */
export default function AutoSweep() {
  const qc = useQueryClient()
  const { isAdmin } = usePermissions()
  const { data: sweep, isLoading } = useQuery({ queryKey: ['invoice-sweep'], queryFn: invoiceSettingsApi.getSweep, enabled: isAdmin })
  const [enabled, setEnabled] = useState(false)
  const [bank, setBank] = useState({ bankCode: '', accountNumber: '' })
  const [accountName, setAccountName] = useState('')
  const [buffer, setBuffer] = useState('0')

  useEffect(() => {
    if (!sweep) return
    setEnabled(sweep.enabled)
    setBank({ bankCode: sweep.bankCode ?? '', accountNumber: sweep.accountNumber ?? '' })
    setAccountName(sweep.accountName ?? '')
    setBuffer(String(sweep.buffer ?? 0))
  }, [sweep])

  const destChanged =
    !!sweep && (bank.bankCode !== (sweep.bankCode ?? '') || bank.accountNumber !== (sweep.accountNumber ?? '') || accountName !== (sweep.accountName ?? ''))
  const hasDest = bankValid(bank.bankCode, bank.accountNumber)

  const save = useMutation({
    mutationFn: () =>
      invoiceSettingsApi.updateSweep({
        enabled,
        buffer: Number(buffer) || 0,
        ...(destChanged && hasDest ? { bankCode: bank.bankCode, accountNumber: bank.accountNumber, accountName: accountName.trim() || undefined } : {}),
      }),
    onSuccess: (s) => {
      toast.success(s.enabled ? `Auto-sweep on → ${s.accountName ?? s.accountNumber}` : 'Auto-sweep settings saved')
      qc.setQueryData(['invoice-sweep'], s)
    },
    onError: (e) => toast.error(apiError(e)),
  })

  return (
    <SettingsSection
      id="invoice-auto-sweep"
      title="Invoice collections — Auto-sweep"
      description="Money paid into invoice collection accounts is moved to your bank automatically, keeping a buffer per payment."
    >
      {!isAdmin ? (
        <AdminOnlyNote />
      ) : isLoading ? (
        <p className="text-sm text-text-dim">Loading…</p>
      ) : (
        <div className="space-y-4">
          <Toggle checked={enabled} onChange={setEnabled} label="Auto-sweep enabled" />
          <BankFields bankCode={bank.bankCode} accountNumber={bank.accountNumber} onChange={setBank} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Account name" hint={sweep?.bankName ? `Verified at ${sweep.bankName}; leave blank to use the bank's name` : 'Filled from bank name enquiry if blank'}>
              <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            </Field>
            <Field label="Buffer kept per payment (₦)" hint={`Each sweep leaves ${money(Number(buffer) || 0)} behind`}>
              <Input type="number" min={0} value={buffer} onChange={(e) => setBuffer(e.target.value)} />
            </Field>
          </div>
          {enabled && !hasDest && <p className="text-xs text-orange">Set a destination account before enabling auto-sweep.</p>}
          <div className="flex justify-end">
            <Button size="sm" disabled={(enabled && !hasDest) || Number(buffer) < 0} isLoading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}
