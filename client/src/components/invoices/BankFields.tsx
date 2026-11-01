import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { banksApi } from '@/lib/api/invoicing'
import { Field } from './shared'

export const useInvoiceBanks = () => useQuery({ queryKey: ['inv-banks'], queryFn: banksApi.list, staleTime: 3_600_000 })

/** Bank select + 10-digit NUBAN. The API verifies the account by name enquiry on save. */
export function BankFields({
  bankCode,
  accountNumber,
  onChange,
  disabled,
}: {
  bankCode: string
  accountNumber: string
  onChange: (v: { bankCode: string; accountNumber: string }) => void
  disabled?: boolean
}) {
  const { data: banks = [] } = useInvoiceBanks()
  const bad = accountNumber !== '' && !/^\d{10}$/.test(accountNumber)
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Bank">
        <Select value={bankCode} disabled={disabled} onChange={(e) => onChange({ bankCode: e.target.value, accountNumber })}>
          <option value="">Select bank…</option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Account number">
        <Input
          inputMode="numeric"
          maxLength={10}
          disabled={disabled}
          value={accountNumber}
          onChange={(e) => onChange({ bankCode, accountNumber: e.target.value.replace(/\D/g, '').slice(0, 10) })}
          error={bad ? 'Must be a 10-digit NUBAN' : undefined}
          placeholder="0123456789"
        />
      </Field>
    </div>
  )
}

export const bankValid = (bankCode: string, accountNumber: string) => !!bankCode && /^\d{10}$/.test(accountNumber)
