import { useEffect, useRef, useState } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { vendorsApi } from '@/lib/api/vendors'
import { apiError } from '@/lib/api/spend'
import { toNumber } from '@/lib/money'
import { spendKeys, useBanks } from '@/components/shared/hooks'
import { TagInput } from '@/components/shared/TagInput'
import type { Vendor, VendorInput } from '@/types/vendors'

type Enquiry =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'verified'; name: string }
  | { status: 'failed'; reason: string }

/**
 * Register / Edit Vendor dialog (spec §5.4): bank dropdown, 10-digit NUBAN with auto name enquiry,
 * Re-check, "save with the name I typed" when the bank can't confirm, contact, phone, TIN, tags, WHT.
 * Props: open, onClose, vendor? (edit mode), initialName? (prefill for inline "Register new vendor"), onSaved?(vendor), readOnly?.
 */
export function VendorDialog({
  open,
  onClose,
  vendor,
  initialName,
  onSaved,
  readOnly,
}: {
  open: boolean
  onClose: () => void
  vendor?: Vendor | null
  initialName?: string
  onSaved?: (v: Vendor) => void
  readOnly?: boolean
}) {
  const qc = useQueryClient()
  const { data: banks = [] } = useBanks()
  const { data: tagCounts = [] } = useQuery({ queryKey: spendKeys.vendorTags, queryFn: vendorsApi.tags, enabled: open })
  const isEdit = !!vendor

  const [name, setName] = useState('')
  const [bankCode, setBankCode] = useState('')
  const [acct, setAcct] = useState('')
  const [enquiry, setEnquiry] = useState<Enquiry>({ status: 'idle' })
  const [allowManual, setAllowManual] = useState(false)
  const [manualName, setManualName] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [tin, setTin] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [whtExempt, setWhtExempt] = useState(false)
  const [whtRatePct, setWhtRatePct] = useState('')
  const [saving, setSaving] = useState(false)
  const lastChecked = useRef('')

  useEffect(() => {
    if (!open) return
    setName(vendor?.name ?? initialName ?? '')
    setBankCode(vendor?.bankCode ?? '')
    setAcct(vendor?.bankAccountNumber ?? '')
    setContactPerson(vendor?.contactPerson ?? '')
    setPhone(vendor?.phone ?? '')
    setTin(vendor?.tin ?? '')
    setTags(vendor?.tags ?? [])
    setWhtExempt(vendor?.whtExempt ?? false)
    setWhtRatePct(vendor?.whtRate && toNumber(vendor.whtRate) > 0 ? String(Math.round(toNumber(vendor.whtRate) * 10000) / 100) : '')
    setAllowManual(false)
    setManualName(vendor && !vendor.isBankVerified ? vendor.accountName ?? '' : '')
    if (vendor?.bankAccountNumber) {
      lastChecked.current = `${vendor.bankCode}|${vendor.bankAccountNumber}`
      setEnquiry(
        vendor.isBankVerified
          ? { status: 'verified', name: vendor.verifiedAccountName ?? vendor.accountName ?? '' }
          : { status: 'failed', reason: 'Not verified with bank' },
      )
    } else {
      lastChecked.current = ''
      setEnquiry({ status: 'idle' })
    }
  }, [open, vendor, initialName])

  const bankChanged = !isEdit || bankCode !== (vendor?.bankCode ?? '') || acct !== (vendor?.bankAccountNumber ?? '')

  const runEnquiry = async (force = false) => {
    if (!bankCode || !/^\d{10}$/.test(acct)) return
    const key = `${bankCode}|${acct}`
    if (!force && key === lastChecked.current) return
    lastChecked.current = key
    setEnquiry({ status: 'checking' })
    try {
      if (isEdit && !bankChanged && vendor) {
        const r = await vendorsApi.recheck(vendor.id)
        if (r.verified) {
          setEnquiry({ status: 'verified', name: r.vendor.verifiedAccountName ?? '' })
          qc.invalidateQueries({ queryKey: spendKeys.vendors })
        } else setEnquiry({ status: 'failed', reason: r.reason ?? 'Bank could not confirm this account' })
        return
      }
      const r = await vendorsApi.verifyAccount(acct, bankCode)
      setEnquiry(r.verified && r.accountName ? { status: 'verified', name: r.accountName } : { status: 'failed', reason: r.reason ?? 'Bank could not confirm this account' })
    } catch (e) {
      setEnquiry({ status: 'failed', reason: apiError(e, 'Name enquiry failed') })
    }
  }

  // Auto name-enquiry once a bank and all 10 digits are present.
  useEffect(() => {
    if (open && bankChanged && bankCode && /^\d{10}$/.test(acct)) void runEnquiry()
    if (open && bankChanged && (!bankCode || acct.length !== 10) && enquiry.status !== 'idle') {
      lastChecked.current = ''
      setEnquiry({ status: 'idle' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankCode, acct, open])

  const save = async () => {
    if (!name.trim()) return toast.error('Vendor name is required')
    if ((bankCode && !acct) || (!bankCode && acct)) return toast.error('Pick a bank and enter the 10-digit account number')
    if (acct && !/^\d{10}$/.test(acct)) return toast.error('Account number must be 10 digits')
    const hasBank = !!(bankCode && acct)
    if (hasBank && bankChanged && enquiry.status !== 'verified' && !(allowManual && manualName.trim())) {
      return toast.error('The bank could not confirm this account. Tick "save with the name I typed" and enter the account name.')
    }
    const rate = whtRatePct.trim() ? Number(whtRatePct) / 100 : null
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 1)) return toast.error('Vendor WHT rate must be between 0 and 100%')

    const body: Partial<VendorInput> = {
      name: name.trim(),
      contactPerson: contactPerson.trim(),
      phone: phone.trim(),
      tin: tin.trim(),
      tags,
      whtExempt,
      whtRate: rate,
    }
    if (bankChanged) {
      body.bankCode = bankCode || undefined
      body.bankAccountNumber = acct || undefined
    }
    if (allowManual && enquiry.status !== 'verified') {
      body.allowUnverified = true
      body.accountName = manualName.trim()
    }
    setSaving(true)
    try {
      const saved = isEdit && vendor ? await vendorsApi.update(vendor.id, body) : await vendorsApi.create(body as VendorInput)
      toast.success(isEdit ? 'Vendor updated' : `${saved.name} registered`)
      qc.invalidateQueries({ queryKey: spendKeys.vendors })
      onSaved?.(saved)
      onClose()
    } catch (e) {
      toast.error(apiError(e, 'Could not save vendor'))
    } finally {
      setSaving(false)
    }
  }

  const sortedBanks = [...banks].sort((a, b) => a.name.localeCompare(b.name))
  const dis = readOnly || saving

  return (
    <Modal isOpen={open} onClose={onClose} title={isEdit ? 'Edit Vendor' : 'Register Vendor'} className="max-w-xl">
      <div className="space-y-4">
        {readOnly && <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-text-dim">Read-only — Poster role required to edit</p>}
        <div className="space-y-1.5">
          <Label required>Vendor name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={dis} placeholder="e.g. Adebayo Provisions Ltd" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Bank</Label>
            <Select value={bankCode} onChange={(e) => setBankCode(e.target.value)} disabled={dis}>
              <option value="">Select bank…</option>
              {bankCode && !sortedBanks.some((b) => b.code === bankCode) && <option value={bankCode}>{vendor?.bankName ?? bankCode}</option>}
              {sortedBanks.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Account number</Label>
            <Input
              inputMode="numeric"
              maxLength={10}
              value={acct}
              disabled={dis}
              onChange={(e) => setAcct(e.target.value.replace(/\D/g, '').slice(0, 10))}
              onBlur={() => void runEnquiry()}
              placeholder="10 digits"
              className="tabular-nums"
            />
          </div>
        </div>

        {(bankCode || acct) && (
          <div className="rounded-xl border border-border bg-secondary/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Account name (from bank)</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                disabled={dis || !bankCode || acct.length !== 10 || enquiry.status === 'checking'}
                onClick={() => void runEnquiry(true)}
              >
                <RefreshCw size={12} /> Re-check
              </Button>
            </div>
            <div className="mt-1 text-sm">
              {enquiry.status === 'idle' && <span className="text-text-dim">Enter all 10 digits to look up the name</span>}
              {enquiry.status === 'checking' && (
                <span className="flex items-center gap-2 text-text-dim">
                  <Loader2 size={14} className="animate-spin" /> Checking with the bank…
                </span>
              )}
              {enquiry.status === 'verified' && (
                <span className="flex items-center gap-2 font-semibold text-green">
                  <CheckCircle2 size={14} /> {enquiry.name}
                </span>
              )}
              {enquiry.status === 'failed' && (
                <span className="flex items-start gap-2 text-orange">
                  <XCircle size={14} className="mt-0.5 shrink-0" /> {enquiry.reason}
                </span>
              )}
            </div>
            {enquiry.status === 'failed' && (
              <div className="mt-3 space-y-2">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={allowManual} disabled={dis} onChange={(e) => setAllowManual(e.target.checked)} />
                  Bank can't confirm — save with the name I typed
                </label>
                {allowManual && (
                  <Input value={manualName} onChange={(e) => setManualName(e.target.value)} disabled={dis} placeholder="Account name exactly as on the account" />
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Contact name</Label>
            <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} disabled={dis} />
          </div>
          <div className="space-y-1.5">
            <Label>Contact phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={dis} inputMode="tel" placeholder="080…" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>TIN</Label>
          <Input value={tin} onChange={(e) => setTin(e.target.value)} disabled={dis} placeholder="12345678-0001" />
          <p className="text-[11px] text-text-dim">Vendor's FIRS Tax Identification Number — used for WHT remittance reports</p>
        </div>
        <div className="space-y-1.5">
          <Label>Tags</Label>
          <TagInput value={tags} onChange={setTags} disabled={dis} suggestions={tagCounts.map((t) => t.tag)} />
        </div>
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
          <label className="flex h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={whtExempt} disabled={dis} onChange={(e) => setWhtExempt(e.target.checked)} />
            WHT exempt
          </label>
          <div className="space-y-1.5">
            <Label>Vendor WHT rate (%)</Label>
            <Input
              value={whtRatePct}
              onChange={(e) => setWhtRatePct(e.target.value.replace(/[^\d.]/g, ''))}
              disabled={dis || whtExempt}
              placeholder="Blank = use COA default"
              inputMode="decimal"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {!readOnly && (
            <Button onClick={save} isLoading={saving}>
              {isEdit ? 'Save changes' : 'Register Vendor'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
