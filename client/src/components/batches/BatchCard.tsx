import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  ChevronDown,
  FileDown,
  FileText,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  RotateCcw,
  Scissors,
  Search,
  Send,
  Sheet as SheetIcon,
  Trash2,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Popover } from '@/components/shared/Popover'
import { cn } from '@/lib/utils'
import { apiErrorMessage, batchKeys, batchesApi } from '@/lib/api/batches'
import { walletKeys } from '@/lib/api/wallet'
import type { BatchDetail, BatchLine, BatchSummary } from '@/types/batches'
import { LineDetailsDialog, SplitLineDialog } from './LineDialogs'
import { BatchStatusPill, LineStatusPill, MicroLabel, PromptDialog, fmtDate, naira, withToast } from './shared'

export interface BatchPerms {
  canApprove: boolean
  canPay: boolean
  isAdmin: boolean
}

type Confirm = { title: string; description: string; confirmText: string; danger?: boolean; run: () => Promise<unknown> }

export function BatchCard({
  batch,
  perms,
  expanded,
  onToggle,
  onDisburse,
  compact,
}: {
  batch: BatchSummary
  perms: BatchPerms
  expanded: boolean
  onToggle: () => void
  onDisburse: () => void
  compact?: boolean
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: batchKeys.all })
    qc.invalidateQueries({ queryKey: walletKeys.all })
  }
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    const r = await withToast(fn, ok)
    setBusy(null)
    if (r !== undefined) refresh()
    return r
  }

  const cancelled = batch.payoutStatus === 'CANCELLED'
  const paidAny = batch.paid > 0
  // Untouched = never disbursed and nothing paid; the server re-checks (no payout attempt ever).
  const maybeUntouched = !batch.disbursedAt && !paidAny && batch.payoutStatus === 'PENDING' && batch.inFlightCount === 0 && batch.failedCount === 0
  const color = batch.payCategoryColor || 'var(--gold)'

  const actions = (
    <div className="flex flex-wrap items-center gap-1.5">
      {perms.canPay && !cancelled && (batch.inFlightCount > 0 || batch.failedCount > 0 || batch.payoutStatus === 'PROCESSING') && (
        <Button
          size="sm"
          variant="outline"
          isLoading={busy === 'check'}
          onClick={() =>
            run('check', async () => {
              const r = await batchesApi.checkStatus(batch.id)
              toast.success(`Checked ${r.checked}: ${r.success} paid, ${r.failed + r.reversed} failed, ${r.pending} pending`)
              return r
            })
          }
        >
          <Search size={13} /> Check status
        </Button>
      )}
      {perms.canApprove && !cancelled && (
        <Button size="sm" variant="outline" isLoading={busy === 'sheet'} onClick={() => run('sheet', () => batchesApi.resyncSheet(batch.id), 'Sheet resynced')}>
          <SheetIcon size={13} /> Resync sheet
        </Button>
      )}
      {perms.canPay && !cancelled && batch.failedCount > 0 && (
        <Button
          size="sm"
          variant="outline"
          isLoading={busy === 'retry'}
          onClick={() =>
            run('retry', async () => {
              const r = await batchesApi.retry(batch.id)
              if (r.reset) toast.success(`${r.reset} line${r.reset === 1 ? '' : 's'} reset — ready to disburse again`)
              if (r.blocked.length) toast.warning(`${r.blocked.length} line${r.blocked.length === 1 ? '' : 's'} not reset: ${r.blocked[0].reason ?? 'not safe yet'}`)
              return r
            })
          }
        >
          <RotateCcw size={13} /> Retry all ({batch.failedCount})
        </Button>
      )}
      {paidAny && (
        <>
          <Button size="sm" variant="outline" isLoading={busy === 'pdf'} onClick={() => run('pdf', () => batchesApi.downloadBatchReceipt(batch.id, batch.batchRef))}>
            <FileText size={13} /> Receipt PDF
          </Button>
          <Button size="sm" variant="outline" isLoading={busy === 'zip'} onClick={() => run('zip', () => batchesApi.downloadBatchZip(batch.id, batch.batchRef))}>
            <FileDown size={13} /> Zip receipts
          </Button>
        </>
      )}
      {perms.isAdmin && maybeUntouched && (
        <Button
          size="sm"
          variant="outline"
          className="text-red hover:text-red"
          onClick={() =>
            setConfirm({
              title: `Delete ${batch.batchRef}?`,
              description: 'This deletes the batch and its lines. Nothing returns to the queue. Only untouched batches (no payout attempt) can be deleted.',
              confirmText: 'Delete batch',
              danger: true,
              run: () => batchesApi.remove(batch.id),
            })
          }
        >
          <Trash2 size={13} /> Delete
        </Button>
      )}
      {perms.canApprove && !cancelled && batch.payoutStatus !== 'SUCCESS' && (
        <Button size="sm" variant="outline" className="text-red hover:text-red" onClick={() => setCancelOpen(true)}>
          <Ban size={13} /> Cancel batch
        </Button>
      )}
      {perms.canPay && batch.isReady && (
        <Button size="sm" onClick={onDisburse}>
          <Send size={13} /> Disburse
        </Button>
      )}
    </div>
  )

  return (
    <div className={cn('rounded-2xl border border-border bg-card', expanded && compact && 'col-span-full')}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={expanded}>
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">
            <span className="font-mono">{batch.batchRef}</span>
            <span className="text-text-dim"> · {batch.payCategoryName ?? 'Uncategorised'}</span>
          </p>
          <p className="text-xs text-text-dim">
            {batch.itemCount} item{batch.itemCount === 1 ? '' : 's'} · {fmtDate(batch.date)}
            {batch.isManual && ' · manual'}
            {batch.failedCount > 0 && <span className="text-red"> · {batch.failedCount} failed</span>}
            {batch.inFlightCount > 0 && <span className="text-purple"> · {batch.inFlightCount} in flight</span>}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-lg font-bold tabular-nums">{naira(batch.total)}</p>
          {batch.paid > 0 && batch.payoutStatus !== 'SUCCESS' && <p className="text-[11px] text-text-dim tabular-nums">{naira(batch.paid)} paid</p>}
        </div>
        <BatchStatusPill status={batch.payoutStatus} />
        <ChevronDown size={18} className={cn('shrink-0 text-text-dim transition-transform', expanded && 'rotate-180')} />
      </button>
      {cancelled && batch.cancelledReason && <p className="px-4 pb-2 text-xs text-text-dim">Cancelled: {batch.cancelledReason}</p>}
      <div className="border-t border-border px-4 py-2.5">{actions}</div>
      {expanded && <ExpandedBatch batchId={batch.id} perms={perms} onChanged={refresh} />}

      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ''}
        description={confirm?.description ?? ''}
        confirmText={confirm?.confirmText}
        isDangerous={confirm?.danger}
        isLoading={confirmBusy}
        onConfirm={async () => {
          if (!confirm) return
          setConfirmBusy(true)
          const r = await withToast(confirm.run, 'Done')
          setConfirmBusy(false)
          if (r !== undefined) {
            setConfirm(null)
            refresh()
          }
        }}
      />
      <PromptDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${batch.batchRef}?`}
        description="Unpaid lines return to the queue as pending. The batch stays on record."
        label="Reason (optional)"
        confirmText="Cancel batch"
        danger
        onSubmit={async (reason) => {
          const r = await withToast(() => batchesApi.cancel(batch.id, reason || undefined), (x) => `Batch cancelled — ${x.returned} line${x.returned === 1 ? '' : 's'} back in the queue`)
          if (r) {
            setCancelOpen(false)
            refresh()
          }
        }}
      />
    </div>
  )
}

type LineDialog = { kind: 'details' | 'split'; line: BatchLine } | null

function ExpandedBatch({ batchId, perms, onChanged }: { batchId: string; perms: BatchPerms; onChanged: () => void }) {
  const q = useQuery({ queryKey: batchKeys.detail(batchId), queryFn: () => batchesApi.get(batchId) })
  const [dialog, setDialog] = useState<LineDialog>(null)
  const [rename, setRename] = useState<{ key: string; label: string } | null>(null)
  const [cancelLine, setCancelLine] = useState<BatchLine | null>(null)
  const [returnLine, setReturnLine] = useState<BatchLine | null>(null)
  const [returnBusy, setReturnBusy] = useState(false)

  if (q.isLoading) return <p className="border-t border-border px-4 py-6 text-center text-sm text-text-dim">Loading lines…</p>
  if (q.isError || !q.data) return <p className="border-t border-border px-4 py-6 text-center text-sm text-red">Couldn't load this batch.</p>
  const b: BatchDetail = q.data

  return (
    <div className="space-y-4 border-t border-border px-4 py-4">
      {b.bundleTotals.length > 0 && (
        <div>
          <MicroLabel className="mb-2">Bundle totals</MicroLabel>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {b.bundleTotals.map((bt) => (
              <div key={bt.bundleKey} className="rounded-xl border border-border bg-secondary/50 p-3">
                <p className="truncate text-sm font-semibold">{bt.label}</p>
                <p className="text-xs text-text-dim">
                  {bt.itemCount} item{bt.itemCount === 1 ? '' : 's'} · <span className="tabular-nums">{naira(bt.paid)}</span> paid of{' '}
                  <span className="tabular-nums">{naira(bt.total)}</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {perms.canApprove && (
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setRename({ key: bt.bundleKey, label: bt.label })}>
                      <Pencil size={12} /> Rename
                    </Button>
                  )}
                  {bt.paid > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => withToast(() => batchesApi.downloadBundleReceipt(b.id, bt.bundleKey, bt.label))}
                    >
                      <FileText size={12} /> Bulk receipt PDF
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-dim">
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2">Bank · Account</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-right">Outstanding</th>
              <th className="px-3 py-2">Payout status</th>
              <th className="px-3 py-2">Message</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {b.items.map((l) => (
              <tr key={l.id} className={cn('border-b border-border last:border-0', l.payoutStatus === 'CANCELLED' && 'opacity-50')}>
                <td className="px-3 py-2 font-medium">
                  {l.vendorName}
                  {l.bundleLabel && <span className="block text-[10px] uppercase tracking-wider text-text-dim">{l.bundleLabel}</span>}
                </td>
                <td className="px-3 py-2 text-xs text-text-dim">
                  {l.vendorBank ?? '—'} · <span className="font-mono">{l.vendorAcctNo ?? '—'}</span>
                </td>
                <td className="max-w-[240px] px-3 py-2 text-xs">
                  <span className="line-clamp-2">{l.description}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{naira(l.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{naira(l.paid)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.isPaid ? <span className="text-green">Paid</span> : naira(l.outstanding)}</td>
                <td className="px-3 py-2">
                  <LineStatusPill line={l} />
                </td>
                <td className="max-w-[200px] px-3 py-2 text-xs text-text-dim">
                  <span className="line-clamp-2">{l.payoutMessage ?? l.unsafeReason ?? ''}</span>
                </td>
                <td className="px-3 py-2">
                  <LineMenu
                    line={l}
                    batch={b}
                    perms={perms}
                    onOpen={(kind) => setDialog({ kind, line: l })}
                    onCancel={() => setCancelLine(l)}
                    onReturn={() => setReturnLine(l)}
                    onChanged={onChanged}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden">
        {b.items.map((l) => (
          <li key={l.id} className={cn('rounded-xl border border-border p-3', l.payoutStatus === 'CANCELLED' && 'opacity-50')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{l.vendorName}</p>
                <p className="truncate text-xs text-text-dim">
                  {l.vendorBank ?? '—'} · {l.vendorAcctNo ?? '—'}
                </p>
              </div>
              <LineMenu
                line={l}
                batch={b}
                perms={perms}
                onOpen={(kind) => setDialog({ kind, line: l })}
                onCancel={() => setCancelLine(l)}
                onReturn={() => setReturnLine(l)}
                onChanged={onChanged}
              />
            </div>
            <p className="mt-1 text-xs">{l.description}</p>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div>
                <MicroLabel>Total</MicroLabel>
                <p className="tabular-nums">{naira(l.total)}</p>
              </div>
              <div>
                <MicroLabel>Paid</MicroLabel>
                <p className="tabular-nums">{naira(l.paid)}</p>
              </div>
              <div>
                <MicroLabel>Outstanding</MicroLabel>
                <p className="tabular-nums">{l.isPaid ? 'Paid' : naira(l.outstanding)}</p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <LineStatusPill line={l} />
              {(l.payoutMessage ?? l.unsafeReason) && <span className="text-xs text-text-dim">{l.payoutMessage ?? l.unsafeReason}</span>}
            </div>
          </li>
        ))}
      </ul>

      <p className="text-right text-xs text-text-dim tabular-nums">
        {naira(b.totals.paid)} paid of {naira(b.totals.total)} · {naira(b.totals.outstanding)} outstanding
      </p>

      {dialog?.kind === 'details' && (
        <LineDetailsDialog
          batchId={b.id}
          line={dialog.line}
          canEdit={perms.canApprove}
          canResync={perms.canApprove}
          onClose={() => setDialog(null)}
          onSaved={onChanged}
        />
      )}
      {dialog?.kind === 'split' && (
        <SplitLineDialog
          batchId={b.id}
          line={dialog.line}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            onChanged()
          }}
        />
      )}
      <PromptDialog
        open={!!rename}
        onClose={() => setRename(null)}
        title="Rename bundle"
        label="Bundle name"
        initial={rename?.label ?? ''}
        required
        onSubmit={async (label) => {
          if (!rename) return
          const r = await withToast(() => batchesApi.renameBundle(b.id, rename.key, label), 'Bundle renamed')
          if (r) {
            setRename(null)
            onChanged()
          }
        }}
      />
      <PromptDialog
        open={!!cancelLine}
        onClose={() => setCancelLine(null)}
        title="Cancel line?"
        description={cancelLine ? `${cancelLine.vendorName} · ${naira(cancelLine.outstanding)} outstanding will not be paid.` : undefined}
        label="Reason (optional)"
        confirmText="Cancel line"
        danger
        onSubmit={async (reason) => {
          if (!cancelLine) return
          const r = await withToast(() => batchesApi.cancelLine(b.id, cancelLine.id, reason || undefined), 'Line cancelled')
          if (r !== undefined) {
            setCancelLine(null)
            onChanged()
          }
        }}
      />
      <ConfirmDialog
        isOpen={!!returnLine}
        onClose={() => setReturnLine(null)}
        title="Return to queue?"
        description={returnLine ? `${returnLine.vendorName} (${naira(returnLine.total)}) goes back to the payment queue as pending.` : ''}
        confirmText="Return to queue"
        isLoading={returnBusy}
        onConfirm={async () => {
          if (!returnLine) return
          setReturnBusy(true)
          const r = await withToast(() => batchesApi.returnLine(b.id, returnLine.id), 'Returned to the queue')
          setReturnBusy(false)
          if (r) {
            setReturnLine(null)
            onChanged()
          }
        }}
      />
    </div>
  )
}

function LineMenu({
  line,
  batch,
  perms,
  onOpen,
  onCancel,
  onReturn,
  onChanged,
}: {
  line: BatchLine
  batch: BatchDetail
  perms: BatchPerms
  onOpen: (kind: 'details' | 'split') => void
  onCancel: () => void
  onReturn: () => void
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const cancelled = line.payoutStatus === 'CANCELLED'
  const batchCancelled = batch.payoutStatus === 'CANCELLED'
  const inFlight = line.payoutStatus === 'SENDING'
  const failed = line.payoutStatus === 'FAILED' || line.payoutStatus === 'REVERSED'

  const items: Array<{ key: string; label: string; icon: typeof Pencil; onClick: () => void; danger?: boolean } | false> = [
    { key: 'details', label: perms.canApprove && !cancelled ? 'Details / reclassify' : 'Details', icon: Pencil, onClick: () => onOpen('details') },
    perms.canApprove && !cancelled && !batchCancelled && !inFlight && line.outstanding >= 2 && { key: 'split', label: 'Split line', icon: Scissors, onClick: () => onOpen('split') },
    perms.canApprove && !cancelled && !line.hasPayoutAttempt && !!line.queueItemId && { key: 'return', label: 'Return to queue', icon: Undo2, onClick: onReturn },
    perms.canApprove && !cancelled && !batchCancelled && !line.isPaid && !inFlight && { key: 'cancel', label: 'Cancel line', icon: Ban, onClick: onCancel, danger: true },
    perms.canPay && failed && !batchCancelled && {
      key: 'retry',
      label: 'Retry',
      icon: RefreshCw,
      onClick: async () => {
        const r = await withToast(() => batchesApi.retry(batch.id, [line.id]))
        if (r) {
          if (r.reset) toast.success('Line reset — ready to disburse again')
          else toast.warning(r.blocked[0]?.reason ?? 'Not safe to retry yet — run Check status first')
          onChanged()
        }
      },
    },
    line.paid > 0 && {
      key: 'pdf',
      label: 'Receipt PDF',
      icon: FileText,
      onClick: () => withToast(() => batchesApi.downloadLineReceipt(batch.id, line.id, line.vendorName)),
    },
    line.paid > 0 && {
      key: 'wa',
      label: 'WhatsApp receipt',
      icon: MessageCircle,
      onClick: async () => {
        // Open the tab synchronously so popup blockers allow it, then point it at wa.me.
        const w = window.open('', '_blank')
        try {
          const r = await batchesApi.whatsapp(batch.id, line.id)
          if (w) w.location.href = r.url
          else window.location.href = r.url
          if (!r.phone) toast.info('No phone number on this vendor — pick the contact in WhatsApp.')
        } catch (err) {
          w?.close()
          toast.error(await apiErrorMessage(err))
        }
      },
    },
  ]
  const visible = items.filter(Boolean) as Exclude<(typeof items)[number], false>[]

  return (
    <div className="w-auto">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="w-56"
        trigger={
          <button
            onClick={() => setOpen((o) => !o)}
            className="rounded-lg p-1.5 text-text-dim hover:bg-secondary hover:text-foreground"
            aria-label={`Actions for ${line.vendorName}`}
          >
            <MoreHorizontal size={16} />
          </button>
        }
      >
        {visible.map((it) => {
          const Icon = it.icon
          return (
            <button
              key={it.key}
              onClick={() => {
                setOpen(false)
                it.onClick()
              }}
              className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary', it.danger && 'text-red')}
            >
              <Icon size={14} /> {it.label}
            </button>
          )
        })}
      </Popover>
    </div>
  )
}
