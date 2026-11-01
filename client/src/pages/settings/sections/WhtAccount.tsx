import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { apiError, whtApi } from '@/lib/api/spend'
import { vendorsApi } from '@/lib/api/vendors'
import { usePermissions } from '@/lib/permissions'
import { spendKeys, useBanks } from '@/components/shared/hooks'
import { MicroChip } from '@/components/shared/Popover'
import { AdminOnlyNote, SettingsSection } from '@/components/shared/SettingsSection'

export default function WhtAccount() {
  const qc = useQueryClient()
  const { isAdmin } = usePermissions()
  const { data: banks = [] } = useBanks()
  const { data: acct, isLoading } = useQuery({ queryKey: spendKeys.whtAccount, queryFn: whtApi.account, enabled: isAdmin })
  const [editing, setEditing] = useState(false)
  const [bankCode, setBankCode] = useState('')
  const [number, setNumber] = useState('')
  const [check, setCheck] = useState<{ s: 'idle' | 'checking' | 'ok' | 'fail'; name?: string; reason?: string }>({ s: 'idle' })
  const [manual, setManual] = useState(false)
  const [manualName, setManualName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (acct) {
      setBankCode(acct.bankCode ?? '')
      setNumber(acct.accountNumber ?? '')
    }
  }, [acct])

  useEffect(() => {
    if (!editing || !bankCode || !/^\d{10}$/.test(number)) return setCheck({ s: 'idle' })
    let live = true
    setCheck({ s: 'checking' })
    vendorsApi
      .verifyAccount(number, bankCode)
      .then((r) => live && setCheck(r.verified ? { s: 'ok', name: r.accountName ?? '' } : { s: 'fail', reason: r.reason }))
      .catch((e) => live && setCheck({ s: 'fail', reason: apiError(e) }))
    return () => {
      live = false
    }
  }, [editing, bankCode, number])

  const save = async () => {
    setSaving(true)
    try {
      await whtApi.updateAccount({ bankCode, accountNumber: number, ...(check.s !== 'ok' && manual ? { allowUnverified: true, accountName: manualName.trim() } : {}) })
      toast.success('WHT destination account saved')
      qc.invalidateQueries({ queryKey: spendKeys.whtAccount })
      setEditing(false)
    } catch (e) {
      toast.error(apiError(e, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    if (!confirm('Remove the WHT destination account? WHT legs will fail until a new one is set.')) return
    try {
      await whtApi.clearAccount()
      qc.invalidateQueries({ queryKey: spendKeys.whtAccount })
      toast.success('WHT account removed')
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  return (
    <SettingsSection id="wht-account" title="WHT destination account" description="Every WHT-tagged payment sends the tax portion here in a second transfer.">
      {!isAdmin ? (
        <AdminOnlyNote />
      ) : isLoading ? (
        <p className="text-sm text-text-dim">Loading…</p>
      ) : !editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {acct?.configured ? (
            <div>
              <div className="font-semibold">{acct.accountName}</div>
              <div className="text-sm tabular-nums text-text-dim">
                {acct.bankName} · {acct.accountNumber}
              </div>
              <MicroChip className={acct.verified ? 'mt-1 text-green' : 'mt-1 text-orange'}>{acct.verified ? 'Verified' : 'Name not confirmed by bank'}</MicroChip>
            </div>
          ) : (
            <p className="text-sm text-orange">Not set — WHT portions can't be remitted until you add an account.</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setEditing(true)}>
              {acct?.configured ? 'Change' : 'Set account'}
            </Button>
            {acct?.configured && (
              <Button size="sm" variant="outline" onClick={clear}>
                Remove
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="max-w-xl space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Bank</Label>
              <Select value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
                <option value="">Select bank…</option>
                {[...banks].sort((a, b) => a.name.localeCompare(b.name)).map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Account number</Label>
              <Input value={number} inputMode="numeric" maxLength={10} onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 10))} className="tabular-nums" />
            </div>
          </div>
          <div className="text-sm">
            {check.s === 'checking' && (
              <span className="flex items-center gap-2 text-text-dim">
                <Loader2 size={14} className="animate-spin" /> Checking name…
              </span>
            )}
            {check.s === 'ok' && (
              <span className="flex items-center gap-2 font-semibold text-green">
                <CheckCircle2 size={14} /> {check.name}
              </span>
            )}
            {check.s === 'fail' && (
              <div className="space-y-2">
                <span className="flex items-center gap-2 text-orange">
                  <XCircle size={14} /> {check.reason ?? 'Bank could not confirm this account'}
                </span>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> Save with manual name
                </label>
                {manual && <Input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Account name" />}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={save} isLoading={saving} disabled={!bankCode || number.length !== 10 || (check.s !== 'ok' && !(manual && manualName.trim()))}>
              Save account
            </Button>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}
