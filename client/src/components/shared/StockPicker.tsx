import { useMemo, useState } from 'react'
import { Package, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatNaira } from '@/lib/money'
import type { StockItem } from '@/types/vendors'
import { useActiveStock } from './hooks'
import { Popover } from './Popover'

/**
 * "Pick a stock item" searchable popover with an item count (spec §5.5). onPick receives the full stock item to prefill the line
 * (description, payCategoryId, coaTagId, vendorId, unitName, unitAmount). Props: onPick(item), disabled?, label?, className?.
 */
export function StockPicker({
  onPick,
  disabled,
  label = 'Pick stock item',
  className,
}: {
  onPick: (item: StockItem) => void
  disabled?: boolean
  label?: string
  className?: string
}) {
  const { data: items = [] } = useActiveStock()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return items
    return items.filter((i) =>
      [i.name, i.description, i.vendor?.name, i.coaTag?.name, i.payCategory?.name].some((f) => (f ?? '').toLowerCase().includes(s)),
    )
  }, [items, q])

  return (
    <div className={className ?? 'w-auto'}>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        className="w-80"
        trigger={
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setOpen((o) => !o)}>
            <Package size={14} /> {label}
            <span className="rounded bg-secondary px-1.5 text-[10px] tabular-nums text-text-dim">{items.length}</span>
          </Button>
        }
      >
        <div className="flex items-center gap-2 border-b border-border px-2 pb-2 pt-1">
          <Search size={14} className="text-text-dim" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${items.length} item${items.length === 1 ? '' : 's'}…`}
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        {matches.length === 0 && <div className="px-3 py-3 text-sm text-text-dim">{items.length ? 'No matches' : 'No stock items yet — add them in Stock.'}</div>}
        {matches.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => {
              onPick(i)
              setOpen(false)
              setQ('')
            }}
            className="flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-accent"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{i.name}</span>
              <span className="block truncate text-[11px] text-text-dim">
                {[i.coaTag?.name, i.vendor?.name, i.unitName].filter(Boolean).join(' · ') || i.description}
              </span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-gold">{formatNaira(i.unitAmount)}</span>
          </button>
        ))}
      </Popover>
    </div>
  )
}
