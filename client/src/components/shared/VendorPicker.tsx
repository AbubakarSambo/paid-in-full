import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VendorDialog } from '@/components/vendors/VendorDialog'
import type { Vendor } from '@/types/vendors'
import { useAllVendors } from './hooks'
import { Popover } from './Popover'

export const vendorHasBank = (v: Pick<Vendor, 'bankCode' | 'bankAccountNumber'> | null | undefined) => !!(v?.bankCode && v?.bankAccountNumber)

/**
 * Vendor typeahead over the register. Shows "— no bank details" for vendors without bank details.
 * Props: value (vendorId|null), onChange(vendor|null), allowRegister? (inline "Register new vendor" opens the vendor dialog),
 * blockNoBank? (vendors without bank details can't be picked), placeholder?, disabled?, className?.
 */
export function VendorPicker({
  value,
  onChange,
  allowRegister = false,
  blockNoBank = false,
  placeholder = 'Search vendors…',
  disabled,
  className,
}: {
  value: string | null | undefined
  onChange: (vendor: Vendor | null) => void
  allowRegister?: boolean
  blockNoBank?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const { data: vendors = [], isLoading } = useAllVendors()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [registerOpen, setRegisterOpen] = useState(false)
  const selected = vendors.find((v) => v.id === value) ?? null

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = s
      ? vendors.filter(
          (v) =>
            v.name.toLowerCase().includes(s) ||
            (v.bankAccountNumber ?? '').includes(s) ||
            (v.bankName ?? '').toLowerCase().includes(s) ||
            v.tags.some((t) => t.toLowerCase().includes(s)),
        )
      : vendors
    return list.slice(0, 50)
  }, [vendors, q])

  return (
    <div className={className}>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        trigger={
          <div
            className={cn(
              'flex h-11 w-full items-center gap-2 rounded-xl border border-input bg-card px-3 text-sm',
              open && 'border-gold ring-2 ring-gold/20',
              disabled && 'cursor-not-allowed opacity-50',
            )}
            onClick={() => !disabled && setOpen(true)}
          >
            <input
              disabled={disabled}
              value={open ? q : selected?.name ?? ''}
              onChange={(e) => {
                setQ(e.target.value)
                setOpen(true)
              }}
              onFocus={() => {
                setQ('')
                setOpen(true)
              }}
              placeholder={isLoading ? 'Loading vendors…' : placeholder}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70"
            />
            {selected && !open && !vendorHasBank(selected) && (
              <span className="shrink-0 text-[11px] text-orange">— no bank details</span>
            )}
            {selected && !disabled ? (
              <button
                type="button"
                aria-label="Clear vendor"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(null)
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={14} />
              </button>
            ) : (
              <ChevronDown size={16} className="text-muted-foreground" />
            )}
          </div>
        }
      >
        {matches.length === 0 && <div className="px-3 py-2 text-sm text-text-dim">No vendors match “{q}”</div>}
        {matches.map((v) => {
          const noBank = !vendorHasBank(v)
          const blocked = blockNoBank && noBank
          return (
            <button
              key={v.id}
              type="button"
              disabled={blocked}
              onClick={() => {
                onChange(v)
                setOpen(false)
                setQ('')
              }}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent',
                v.id === value && 'bg-gold/10',
                blocked && 'cursor-not-allowed opacity-50 hover:bg-transparent',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{v.name}</span>
                <span className="block truncate text-[11px] text-text-dim">
                  {noBank ? <span className="text-orange">— no bank details{blocked ? ' (add them in Vendors first)' : ''}</span> : `${v.bankName ?? ''} · ${v.bankAccountNumber}`}
                </span>
              </span>
              {v.isBankVerified && <CheckCircle2 size={14} className="shrink-0 text-green" />}
              {noBank && <AlertTriangle size={14} className="shrink-0 text-orange" />}
            </button>
          )
        })}
        {allowRegister && (
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setRegisterOpen(true)
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-border px-3 py-2 text-left text-sm font-semibold text-gold hover:bg-gold/10"
          >
            <Plus size={14} /> Register new vendor{q.trim() ? ` “${q.trim()}”` : ''}
          </button>
        )}
      </Popover>
      {allowRegister && (
        <VendorDialog
          open={registerOpen}
          onClose={() => setRegisterOpen(false)}
          initialName={q.trim()}
          onSaved={(v) => {
            onChange(v)
            setQ('')
          }}
        />
      )}
    </div>
  )
}
