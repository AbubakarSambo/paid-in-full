import { useState } from 'react'
import { ChevronDown, ChevronRight, MessageSquare, Paperclip, Plus, Scissors, Ban, Trash2, Zap, X, Eye, Repeat } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatNaira } from '@/lib/money'
import { Chip, shortDate } from './common'
import type { QueueBundleEntry, QueueLane as Lane, QueueListItem } from '@/types/queue'

export interface LaneHandlers {
  onView: (item: QueueListItem) => void
  onSplit: (item: QueueListItem) => void
  onReject: (item: QueueListItem) => void
  onDelete: (item: QueueListItem) => void
  onBundleUrgent: (bundle: QueueBundleEntry, isUrgent: boolean) => void
  onDeleteBundle: (bundle: QueueBundleEntry) => void
  onAddToBundle: (bundle: QueueBundleEntry) => void
}

interface Props extends LaneHandlers {
  lane: Lane
  collapsed: boolean
  onToggleCollapse: () => void
  view: 'list' | 'card'
  selected: Set<string>
  onSelect: (ids: string[], on: boolean) => void
  canPost: boolean
  canApprove: boolean
}

function Checkbox({ checked, indeterminate, onChange, disabled }: { checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <input
      type="checkbox"
      className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--gold)] disabled:cursor-not-allowed"
      checked={checked}
      disabled={disabled}
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate && !checked
      }}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

function RowActions({ item, h, canPost, canApprove, compact }: { item: QueueListItem; h: LaneHandlers; canPost: boolean; canApprove: boolean; compact?: boolean }) {
  const btn = 'rounded-md p-1.5 text-text-dim hover:bg-surface3 hover:text-foreground transition-colors'
  return (
    <div className={cn('flex items-center gap-0.5', !compact && 'sm:opacity-0 sm:group-hover:opacity-100 transition-opacity')}>
      <button className={btn} title="View / comment" onClick={(e) => (e.stopPropagation(), h.onView(item))}>
        <Eye size={14} />
      </button>
      {canApprove && (
        <button className={btn} title="Split" onClick={(e) => (e.stopPropagation(), h.onSplit(item))}>
          <Scissors size={14} />
        </button>
      )}
      {canApprove && (
        <button className={cn(btn, 'hover:text-orange')} title="Cancel (reject — won't be paid)" onClick={(e) => (e.stopPropagation(), h.onReject(item))}>
          <Ban size={14} />
        </button>
      )}
      {canPost && (
        <button className={cn(btn, 'hover:text-red')} title="Delete (genuine mistakes)" onClick={(e) => (e.stopPropagation(), h.onDelete(item))}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

function ItemMeta({ item }: { item: QueueListItem }) {
  return (
    <>
      {item.isUrgent && <Chip tone="orange">Urgent</Chip>}
      {item.noTinPhone && (
        <Chip tone="purple" title="Vendor is missing a TIN or phone — chase these before paying">
          No TIN / Phone
        </Chip>
      )}
      {item.noBankDetails && <Chip tone="red">No bank</Chip>}
      {item.coaTag && <Chip>{item.coaTag}</Chip>}
      {item.recurrenceId && (
        <Chip tone="blue" title="Recurring payment">
          <Repeat size={9} /> Recurring
        </Chip>
      )}
      {item.commentCount > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[11px] text-text-muted">
          <MessageSquare size={11} /> {item.commentCount}
        </span>
      )}
      {item.attachmentCount > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[11px] text-text-muted">
          <Paperclip size={11} /> {item.attachmentCount}
        </span>
      )}
    </>
  )
}

function ItemRow({ item, selected, onSelect, h, canPost, canApprove, nested }: {
  item: QueueListItem
  selected: boolean
  onSelect?: (on: boolean) => void
  h: LaneHandlers
  canPost: boolean
  canApprove: boolean
  nested?: boolean
}) {
  return (
    <div
      className={cn(
        'group flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface2/60 transition-colors',
        selected && 'bg-gold/5',
        nested && 'pl-9',
      )}
      onClick={() => h.onView(item)}
    >
      {onSelect ? <Checkbox checked={selected} onChange={onSelect} disabled={!canApprove} /> : <span className="w-4" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{item.description}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="max-w-[180px] truncate text-xs text-text-dim">{item.vendorName}</span>
          <ItemMeta item={item} />
        </div>
      </div>
      <RowActions item={item} h={h} canPost={canPost} canApprove={canApprove} />
      <div className="w-28 shrink-0 text-right text-sm font-semibold tabular-nums">{formatNaira(item.total)}</div>
    </div>
  )
}

function BundleCard({ bundle, selected, onSelect, h, canPost, canApprove }: {
  bundle: QueueBundleEntry
  selected: Set<string>
  onSelect: (ids: string[], on: boolean) => void
  h: LaneHandlers
  canPost: boolean
  canApprove: boolean
}) {
  const [open, setOpen] = useState(false)
  const ids = bundle.items.map((i) => i.id)
  const all = ids.every((id) => selected.has(id))
  const some = ids.some((id) => selected.has(id))
  return (
    <div className="relative mx-2 my-1.5 overflow-hidden rounded-xl border border-border bg-surface2/40">
      <div className="absolute inset-y-0 left-0 w-1 bg-gold" />
      <div className="flex cursor-pointer items-center gap-3 py-2.5 pl-4 pr-3" onClick={() => setOpen((o) => !o)}>
        <Checkbox checked={all} indeterminate={some} onChange={(v) => onSelect(ids, v)} disabled={!canApprove} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{bundle.bundleLabel || 'Bundle'}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-text-dim">
              {bundle.itemCount} sub-item{bundle.itemCount === 1 ? '' : 's'} · {bundle.vendorCount} vendor{bundle.vendorCount === 1 ? '' : 's'}
            </span>
            {bundle.isUrgent && <Chip tone="orange">Urgent</Chip>}
            <Chip tone="gold">Bundle · {bundle.itemCount}</Chip>
            {bundle.coaTags.map((c) => (
              <Chip key={c}>{c}</Chip>
            ))}
            {bundle.pnlPeriods.map((p) => (
              <Chip key={p} tone="blue">P&amp;L {p}</Chip>
            ))}
            {bundle.createdByName && <span className="text-[11px] text-text-muted">by {bundle.createdByName}</span>}
          </div>
        </div>
        {canPost && (
          <button
            className={cn('rounded-md p-1.5 hover:bg-surface3', bundle.isUrgent ? 'text-orange' : 'text-text-dim')}
            title={bundle.isUrgent ? 'Mark all not urgent' : 'Mark all urgent'}
            onClick={(e) => (e.stopPropagation(), h.onBundleUrgent(bundle, !bundle.isUrgent))}
          >
            <Zap size={14} fill={bundle.isUrgent ? 'currentColor' : 'none'} />
          </button>
        )}
        {canPost && (
          <button
            className="rounded-md p-1.5 text-text-dim hover:bg-surface3 hover:text-red"
            title="Delete entire bundle"
            onClick={(e) => (e.stopPropagation(), h.onDeleteBundle(bundle))}
          >
            <X size={14} />
          </button>
        )}
        <div className="w-28 shrink-0 text-right text-sm font-semibold tabular-nums">{formatNaira(bundle.total)}</div>
        {open ? <ChevronDown size={16} className="text-text-dim" /> : <ChevronRight size={16} className="text-text-dim" />}
      </div>
      {open && (
        <div className="border-t border-border bg-background/40">
          {bundle.items.map((i) => (
            <ItemRow key={i.id} item={i} selected={selected.has(i.id)} h={h} canPost={canPost} canApprove={canApprove} nested />
          ))}
          <div className="flex items-center justify-between border-t border-border px-4 py-2">
            {canPost ? (
              <button className="inline-flex items-center gap-1 text-xs font-semibold text-gold hover:underline" onClick={() => h.onAddToBundle(bundle)}>
                <Plus size={12} /> Add items to bundle
              </button>
            ) : (
              <span />
            )}
            <span className="text-xs text-text-dim">
              Bundle total <span className="ml-1 font-semibold tabular-nums text-foreground">{formatNaira(bundle.total)}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function CardTile({ item, bundle, selected, onSelect, h, canApprove }: {
  item?: QueueListItem
  bundle?: QueueBundleEntry
  selected: boolean
  onSelect: (on: boolean) => void
  h: LaneHandlers
  canApprove: boolean
}) {
  const first = item ?? bundle!.items[0]
  const title = item ? item.description : bundle!.bundleLabel || 'Bundle'
  const total = item ? item.total : bundle!.total
  const req = first.requisition
  return (
    <div
      className={cn(
        'flex cursor-pointer flex-col gap-2 rounded-xl border border-border bg-surface2/40 p-3 hover:border-gold/40 transition-colors',
        selected && 'border-gold/60 bg-gold/5',
      )}
      onClick={() => h.onView(first)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-text-muted">#{first.shortId}</span>
        <Checkbox checked={selected} onChange={onSelect} disabled={!canApprove} />
      </div>
      <div className="line-clamp-2 text-sm font-medium">{title}</div>
      <div className="truncate text-xs text-text-dim">
        {item ? item.vendorName : `${bundle!.itemCount} sub-items · ${bundle!.vendorCount} vendors`}
      </div>
      <div className="flex flex-wrap gap-1">
        {item ? <ItemMeta item={item} /> : <Chip tone="gold">Bundle · {bundle!.itemCount}</Chip>}
      </div>
      {(req?.requesterName || first.requestedByName) && (
        <div className="truncate text-[11px] text-text-muted">
          Req by {req?.requesterName ?? first.requestedByName}
          {first.createdByName ? ` · Ap… ${first.createdByName}` : ''}
        </div>
      )}
      <div className="mt-auto flex items-end justify-between">
        <span className="text-[11px] text-text-muted">{shortDate(first.date)}</span>
        <span className="text-base font-bold tabular-nums">{formatNaira(total)}</span>
      </div>
    </div>
  )
}

export function QueueLaneView(props: Props) {
  const { lane, collapsed, onToggleCollapse, view, selected, onSelect, canPost, canApprove, ...h } = props
  const laneIds = lane.entries.flatMap((e) => (e.type === 'item' ? [e.item.id] : e.items.map((i) => i.id)))
  const allSel = laneIds.length > 0 && laneIds.every((id) => selected.has(id))
  const someSel = laneIds.some((id) => selected.has(id))

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <header className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-surface2/40" onClick={onToggleCollapse}>
        {collapsed ? <ChevronRight size={16} className="text-text-dim" /> : <ChevronDown size={16} className="text-text-dim" />}
        {canApprove && laneIds.length > 0 && (
          <Checkbox checked={allSel} indeterminate={someSel} onChange={(v) => onSelect(laneIds, v)} />
        )}
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: lane.color }} />
        <span className="truncate text-sm font-bold uppercase tracking-wider">{lane.name}</span>
        <span className="rounded-full bg-surface2 px-2 py-0.5 text-[11px] font-semibold text-text-dim tabular-nums">{lane.itemCount}</span>
        {lane.overBudget && (
          <Chip
            tone="red"
            title={`${lane.overBudget.coaTag} · ${formatNaira(lane.overBudget.spent)} of ${formatNaira(lane.overBudget.cap)} (${lane.overBudget.period}${lane.overBudget.costCenter ? ` · ${lane.overBudget.costCenter}` : ''})`}
          >
            {lane.overBudget.coaTag} · {lane.overBudget.pct}%
          </Chip>
        )}
        <span className="ml-auto text-base font-bold tabular-nums">{formatNaira(lane.total)}</span>
      </header>
      {!collapsed && (
        <div className="border-t border-border">
          {lane.entries.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-text-muted">Nothing waiting in {lane.name}.</div>
          ) : view === 'list' ? (
            <div className="divide-y divide-border/60">
              {lane.entries.map((e) =>
                e.type === 'item' ? (
                  <ItemRow
                    key={e.item.id}
                    item={e.item}
                    selected={selected.has(e.item.id)}
                    onSelect={(v) => onSelect([e.item.id], v)}
                    h={h}
                    canPost={canPost}
                    canApprove={canApprove}
                  />
                ) : (
                  <BundleCard key={e.bundleId} bundle={e} selected={selected} onSelect={onSelect} h={h} canPost={canPost} canApprove={canApprove} />
                ),
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {lane.entries.map((e) => {
                if (e.type === 'item') {
                  return (
                    <CardTile
                      key={e.item.id}
                      item={e.item}
                      selected={selected.has(e.item.id)}
                      onSelect={(v) => onSelect([e.item.id], v)}
                      h={h}
                      canApprove={canApprove}
                    />
                  )
                }
                const ids = e.items.map((i) => i.id)
                return (
                  <CardTile
                    key={e.bundleId}
                    bundle={e}
                    selected={ids.every((id) => selected.has(id))}
                    onSelect={(v) => onSelect(ids, v)}
                    h={h}
                    canApprove={canApprove}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
