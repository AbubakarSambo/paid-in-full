import { BadgeCheck, Pencil, ShieldAlert, Trash2 } from 'lucide-react'
import { MicroChip } from '@/components/shared/Popover'
import type { Vendor } from '@/types/vendors'

/** Vendor register card (spec §5.4). */
export function VendorCard({
  vendor: v,
  onEdit,
  onDelete,
}: {
  vendor: Vendor
  onEdit?: () => void
  onDelete?: () => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate font-semibold">{v.name}</h3>
        <div className="flex shrink-0 gap-1">
          {onEdit && (
            <button onClick={onEdit} className="rounded p-1 text-text-dim hover:bg-accent hover:text-foreground" aria-label="Edit">
              <Pencil size={14} />
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="rounded p-1 text-text-dim hover:bg-red/10 hover:text-red" aria-label="Delete">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      <VerifiedBadge vendor={v} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-text-dim">Bank</dt>
        <dd className="truncate">{v.bankName ?? <span className="text-orange">— no bank details</span>}</dd>
        <dt className="text-text-dim">Account</dt>
        <dd className="tabular-nums">{v.bankAccountNumber ?? '—'}</dd>
        <dt className="text-text-dim">Name</dt>
        <dd className="truncate">{v.verifiedAccountName ?? v.accountName ?? v.contactPerson ?? '—'}</dd>
        {v.contactPerson && (
          <>
            <dt className="text-text-dim">Contact</dt>
            <dd className="truncate">{v.contactPerson}</dd>
          </>
        )}
        <dt className="text-text-dim">Phone</dt>
        <dd>{v.phone ?? <span className="text-purple">—</span>}</dd>
        <dt className="text-text-dim">TIN</dt>
        <dd>{v.tin ?? <span className="text-purple">No TIN</span>}</dd>
      </dl>
      {v.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {v.tags.map((t) => (
            <MicroChip key={t} className="text-text-dim">
              {t}
            </MicroChip>
          ))}
        </div>
      )}
    </div>
  )
}

/** VERIFIED / Not verified with bank chip. */
export function VerifiedBadge({ vendor: v }: { vendor: Vendor }) {
  if (v.isBankVerified)
    return (
      <MicroChip className="w-fit border-green/30 bg-green/10 text-green">
        <BadgeCheck size={11} /> Verified
      </MicroChip>
    )
  return (
    <MicroChip className="w-fit border-orange/30 bg-orange/10 text-orange">
      <ShieldAlert size={11} /> Not verified with bank
    </MicroChip>
  )
}
