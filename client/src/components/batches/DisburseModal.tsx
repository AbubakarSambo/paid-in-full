import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, Download, Loader2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  apiErrorMessage,
  batchKeys,
  batchesApi,
  disburseAuthApi,
  inflightStore,
  isOutcomeUnknown,
} from '@/lib/api/batches'
import { walletKeys } from '@/lib/api/wallet'
import type { BatchLine, DisbursePreview, DisbursePreviewInput, DisburseResult, LineResultLabel } from '@/types/batches'
import { MicroLabel, Sheet, kobo, naira, nairaExact, parseAmount } from './shared'

type Phase = 'select' | 'confirm' | 'sending' | 'recovering' | 'result'

/** How long the recovery endpoint may answer "nothing recorded" before we conclude nothing was sent. */
const NOT_FOUND_SETTLE_MS = 60_000
const RECOVERY_POLL_MS = 3_000
const AWAITING_POLL_MS = 5_000
const AWAITING_POLL_MAX_MS = 120_000

interface Props {
  batchId: string
  batchRef: string
  onClose: () => void
  /** Resume an interrupted request (from sessionStorage) instead of starting a new one. */
  resumeClientRequestId?: string
}

const amountString = (n: number) => (Math.round(n * 100) / 100).toString()

export function DisburseModal({ batchId, batchRef, onClose, resumeClientRequestId }: Props) {
  const qc = useQueryClient()
  // One id per modal open. It is reused for every retry of this payment so the server can never
  // execute it twice; a new id only exists after the modal is closed and opened again.
  const [clientRequestId] = useState(() => resumeClientRequestId ?? crypto.randomUUID())
  const [phase, setPhase] = useState<Phase>(resumeClientRequestId ? 'recovering' : 'select')

  const detailQ = useQuery({ queryKey: batchKeys.detail(batchId), queryFn: () => batchesApi.get(batchId), enabled: !resumeClientRequestId })
  const pinQ = useQuery({ queryKey: ['me', 'pin'], queryFn: disburseAuthApi.pinStatus })
  const reauthQ = useQuery({ queryKey: ['app-config', 'require_reauth_for_disbursement'], queryFn: disburseAuthApi.requiresReauth })

  // ─── Selection ───
  const payable = useMemo(
    () => (detailQ.data?.items ?? []).filter((l) => l.payoutStatus !== 'CANCELLED' && l.outstanding > 0),
    [detailQ.data],
  )
  const hiddenCount = (detailQ.data?.items.length ?? 0) - payable.length
  const [sel, setSel] = useState<Record<string, { checked: boolean; amount: string }>>({})
  const initialised = useRef(false)
  useEffect(() => {
    if (initialised.current || !detailQ.data) return
    initialised.current = true
    const next: typeof sel = {}
    for (const l of payable) next[l.id] = { checked: l.selectable, amount: amountString(l.outstanding) }
    setSel(next)
  }, [detailQ.data, payable])
  const [aggregate, setAggregate] = useState(false)

  const lineError = (l: BatchLine): string | null => {
    const s = sel[l.id]
    if (!s?.checked) return null
    const a = parseAmount(s.amount)
    if (!Number.isFinite(a) || a <= 0) return 'Enter an amount'
    if (kobo(a) > kobo(l.outstanding)) return `Max ${nairaExact(l.outstanding)}`
    return null
  }
  const selected = payable.filter((l) => l.selectable && sel[l.id]?.checked)
  const anyLineError = selected.some((l) => lineError(l))
  const request: DisbursePreviewInput | null =
    selected.length && !anyLineError
      ? { lines: selected.map((l) => ({ itemId: l.id, amount: parseAmount(sel[l.id].amount) })), aggregateByVendor: aggregate }
      : null
  const requestKey = request ? JSON.stringify(request) : ''

  // Debounce the preview so typing an amount doesn't hammer the API.
  const [debouncedKey, setDebouncedKey] = useState(requestKey)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKey(requestKey), 350)
    return () => clearTimeout(t)
  }, [requestKey])
  const previewQ = useQuery({
    queryKey: ['batches', 'disburse-preview', batchId, debouncedKey],
    queryFn: () => batchesApi.previewDisburse(batchId, JSON.parse(debouncedKey) as DisbursePreviewInput),
    enabled: !!debouncedKey && (phase === 'select' || phase === 'confirm'),
    staleTime: 0,
  })
  const preview: DisbursePreview | undefined = debouncedKey === requestKey ? previewQ.data : undefined
  const previewFresh = !!preview && !previewQ.isFetching
  const previewByItem = useMemo(() => new Map((preview?.lines ?? []).map((p) => [p.itemId, p])), [preview])
  const whtBlocked = (preview?.lines ?? []).filter((l) => l.status === 'BLOCKED' && /WHT/i.test(l.message ?? ''))

  // ─── Confirmation ───
  const [typed, setTyped] = useState('')
  const [pin, setPin] = useState('')
  const [password, setPassword] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const hasPin = pinQ.data?.hasPin === true
  const pinLocked = !!pinQ.data?.lockedUntil
  const needsPassword = reauthQ.data === true
  const typedValue = parseAmount(typed)
  const typedOk = !!preview && Number.isFinite(typedValue) && kobo(typedValue) === kobo(preview.total)
  const pinOk = /^\d{4,8}$/.test(pin)
  const passwordOk = !needsPassword || password.length > 0
  const authLoaded = pinQ.isSuccess && reauthQ.isSuccess
  const canContinue = previewFresh && !!preview?.canSubmit && !anyLineError
  const canSubmit = canContinue && authLoaded && hasPin && !pinLocked && typedOk && pinOk && passwordOk

  // ─── Sending / recovery ───
  const [result, setResult] = useState<DisburseResult | null>(null)
  const [recoveryNote, setRecoveryNote] = useState<string | null>(null)
  const [sentLines, setSentLines] = useState<Array<{ vendorName: string; amount: number }>>([])
  const firstNotFoundAt = useRef<number | null>(null)
  const awaitingSince = useRef<number | null>(null)
  const [awaitingPollStopped, setAwaitingPollStopped] = useState(false)
  const [checking, setChecking] = useState(false)

  const refreshEverything = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['batches'] })
    qc.invalidateQueries({ queryKey: walletKeys.all })
  }, [qc])

  // Warn before closing the tab while the outcome is unknown.
  useEffect(() => {
    if (phase !== 'sending' && phase !== 'recovering') return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [phase])

  const submit = async () => {
    if (!canSubmit || !request || !preview) return
    setSubmitError(null)
    setSentLines(preview.lines.filter((l) => l.status === 'OK').map((l) => ({ vendorName: l.vendorName, amount: l.amount })))
    inflightStore.save({ batchId, batchRef, clientRequestId, startedAt: Date.now() })
    setPhase('sending')
    try {
      const res = await batchesApi.disburse(batchId, {
        ...request,
        clientRequestId,
        typedTotal: typedValue,
        pin,
        ...(needsPassword && { password }),
      })
      setResult(res)
      setPhase('result')
      refreshEverything()
    } catch (err) {
      if (isOutcomeUnknown(err)) {
        // The request may have gone through. Never resubmit: ask the ledger what happened.
        firstNotFoundAt.current = null
        setRecoveryNote('The connection dropped before Monnify answered. Checking the payout ledger for the true outcome…')
        setPhase('recovering')
        return
      }
      // A 4xx means the server rejected the request before anything was sent.
      inflightStore.clear(batchId)
      setPin('')
      setSubmitError(await apiErrorMessage(err, 'The disbursement was not sent.'))
      setPhase('confirm')
      qc.invalidateQueries({ queryKey: ['me', 'pin'] })
      previewQ.refetch()
    }
  }

  // Poll the recovery endpoint while recovering.
  useEffect(() => {
    if (phase !== 'recovering') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const r = await batchesApi.recovery(batchId, clientRequestId)
        if (cancelled) return
        if (r.found) {
          setResult(r)
          setRecoveryNote(null)
          setPhase('result')
          refreshEverything()
          return
        }
        firstNotFoundAt.current ??= Date.now()
        if (Date.now() - firstNotFoundAt.current >= NOT_FOUND_SETTLE_MS) {
          inflightStore.clear(batchId)
          setRecoveryNote(null)
          setSubmitError(`${r.message} You can review the selection and try again.`)
          setPin('')
          setPhase(resumeClientRequestId ? 'result' : 'confirm')
          refreshEverything()
          return
        }
        setRecoveryNote('Nothing recorded yet — the request may still be processing. Checking again…')
      } catch {
        if (cancelled) return
        setRecoveryNote("Still can't reach Paid in Full. Retrying — your payment will not be sent twice.")
      }
      timer = setTimeout(tick, RECOVERY_POLL_MS)
    }
    tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [phase, batchId, clientRequestId, refreshEverything, resumeClientRequestId])

  // While some lines are awaiting confirmation, keep reading the ledger for a while.
  useEffect(() => {
    if (phase !== 'result' || !result || result.complete || awaitingPollStopped) return
    awaitingSince.current ??= Date.now()
    const t = setTimeout(async () => {
      if (Date.now() - (awaitingSince.current ?? 0) > AWAITING_POLL_MAX_MS) {
        setAwaitingPollStopped(true)
        return
      }
      try {
        const r = await batchesApi.recovery(batchId, clientRequestId)
        if (r.found) {
          setResult(r)
          if (r.complete) refreshEverything()
        }
      } catch {
        /* keep the last known result */
      }
    }, AWAITING_POLL_MS)
    return () => clearTimeout(t)
  }, [phase, result, awaitingPollStopped, batchId, clientRequestId, refreshEverything])

  const checkStatus = async () => {
    setChecking(true)
    try {
      const s = await batchesApi.checkStatus(batchId)
      const r = await batchesApi.recovery(batchId, clientRequestId)
      if (r.found) setResult(r)
      toast.success(`Checked ${s.checked} transfer${s.checked === 1 ? '' : 's'}: ${s.success} paid, ${s.failed + s.reversed} failed, ${s.pending} pending`)
      refreshEverything()
    } catch (err) {
      toast.error(await apiErrorMessage(err))
    } finally {
      setChecking(false)
    }
  }

  const close = () => {
    if (phase === 'sending' || phase === 'recovering') return
    if (phase === 'result') inflightStore.clear(batchId)
    refreshEverything()
    onClose()
  }

  const locked = phase === 'sending' || phase === 'recovering'

  // ─── Render ───
  const footer = (() => {
    if (phase === 'select')
      return (
        <>
          <Button variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canContinue} onClick={() => { setSubmitError(null); setPhase('confirm') }}>
            Continue
          </Button>
        </>
      )
    if (phase === 'confirm')
      return (
        <>
          <Button variant="outline" size="sm" onClick={() => setPhase('select')}>
            Back
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={submit}>
            Disburse {preview ? nairaExact(preview.total) : ''}
          </Button>
        </>
      )
    if (phase === 'result')
      return (
        <>
          {result && result.summary.awaiting > 0 && (
            <Button variant="outline" size="sm" isLoading={checking} onClick={checkStatus}>
              <RefreshCw size={14} /> Check status
            </Button>
          )}
          {result && result.summary.paid > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => batchesApi.downloadBatchReceipt(batchId, batchRef).catch(async (e) => toast.error(await apiErrorMessage(e)))}
            >
              <Download size={14} /> Receipt PDF
            </Button>
          )}
          <Button size="sm" onClick={close}>
            Done
          </Button>
        </>
      )
    return null
  })()

  return (
    <Sheet
      open
      onClose={close}
      locked={locked}
      title={phase === 'result' ? 'Disbursement result' : 'Disburse to Vendors'}
      description={<span className="font-mono text-xs">{batchRef}</span>}
      footer={footer}
      className="sm:max-w-3xl"
    >
      {(phase === 'select' || phase === 'confirm') && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-orange/40 bg-orange/10 px-3 py-2.5 text-sm text-orange">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="font-semibold">This will move real money via Monnify.</span>
        </div>
      )}

      {phase === 'select' && (
        <SelectStep
          loading={detailQ.isLoading}
          payable={payable}
          hiddenCount={hiddenCount}
          sel={sel}
          setSel={setSel}
          lineError={lineError}
          previewByItem={previewByItem}
          aggregate={aggregate}
          setAggregate={setAggregate}
        />
      )}

      {(phase === 'select' || phase === 'confirm') && (
        <TotalsPanel
          preview={preview}
          loading={!!request && !previewFresh}
          nothingSelected={!selected.length}
          anyLineError={anyLineError}
          whtBlockedCount={whtBlocked.length}
        />
      )}

      {phase === 'confirm' && preview && (
        <div className="mt-4 space-y-4">
          {submitError && (
            <div className="flex items-start gap-2 rounded-xl border border-red/40 bg-red/10 px-3 py-2.5 text-sm text-red">
              <XCircle size={16} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Not sent</p>
                <p>{submitError}</p>
                {/WHT/i.test(submitError) && (
                  <Link to="/app/settings#wht-account" className="mt-1 inline-block font-semibold underline">
                    Set the WHT destination account in Settings
                  </Link>
                )}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label required>Type the total to confirm</Label>
            <Input
              inputMode="decimal"
              autoComplete="off"
              placeholder={nairaExact(preview.total)}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="font-mono tabular-nums"
              error={typed && !typedOk ? `Must be exactly ${nairaExact(preview.total)}` : undefined}
            />
            <p className="text-xs text-text-dim">
              Type <span className="font-mono font-semibold text-foreground">{nairaExact(preview.total).replace('₦', '')}</span> exactly.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label required>Disbursement PIN</Label>
              {pinQ.isSuccess && !hasPin ? (
                <div className="rounded-xl border border-red/40 bg-red/10 px-3 py-2.5 text-sm text-red">
                  You have not set your PIN — you cannot pay until you do.{' '}
                  <Link to="/app/settings#disbursement-pin" className="font-semibold underline">
                    Set your PIN in Settings
                  </Link>
                </div>
              ) : (
                <>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={8}
                    value={pin}
                    disabled={pinLocked}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    className="font-mono tracking-[0.4em]"
                    error={pin && !pinOk ? '4–8 digits' : undefined}
                  />
                  {pinLocked ? (
                    <p className="text-xs text-red">PIN locked after too many attempts. Try again later.</p>
                  ) : (
                    <Link to="/app/settings#disbursement-pin" className="text-xs text-gold hover:underline">
                      Forgot or need to reset your PIN?
                    </Link>
                  )}
                </>
              )}
            </div>
            {needsPassword && (
              <div className="space-y-1.5">
                <Label required>Account password</Label>
                <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <p className="text-xs text-text-dim">This workspace requires re-authentication to disburse.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {phase === 'sending' && (
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-3">
            <Loader2 size={22} className="animate-spin text-gold" />
            <div>
              <p className="font-semibold text-foreground">Sending transfers in secure groups…</p>
              <p className="text-sm text-text-dim">This window stays open until every line is confirmed.</p>
            </div>
          </div>
          <DoNotClose />
          <ul className="divide-y divide-border rounded-xl border border-border">
            {sentLines.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="truncate">{l.vendorName}</span>
                <span className="font-mono tabular-nums text-text-dim">{nairaExact(l.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase === 'recovering' && (
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-3">
            <Loader2 size={22} className="animate-spin text-gold" />
            <div>
              <p className="font-semibold text-foreground">Recovering the outcome of this disbursement…</p>
              <p className="text-sm text-text-dim">{recoveryNote ?? 'Reading the payout ledger…'}</p>
            </div>
          </div>
          <DoNotClose />
          <p className="font-mono text-[11px] text-text-muted">Request {clientRequestId}</p>
        </div>
      )}

      {phase === 'result' && result && <ResultView result={result} awaitingPollStopped={awaitingPollStopped} />}
      {phase === 'result' && !result && submitError && (
        <div className="rounded-xl border border-border bg-secondary px-3 py-3 text-sm">{submitError}</div>
      )}
    </Sheet>
  )
}

function DoNotClose() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red/40 bg-red/10 px-3 py-2.5 text-sm font-semibold text-red">
      <ShieldAlert size={16} className="mt-0.5 shrink-0" />
      Do not close this window or pay again.
    </div>
  )
}

function SelectStep({
  loading,
  payable,
  hiddenCount,
  sel,
  setSel,
  lineError,
  previewByItem,
  aggregate,
  setAggregate,
}: {
  loading: boolean
  payable: BatchLine[]
  hiddenCount: number
  sel: Record<string, { checked: boolean; amount: string }>
  setSel: React.Dispatch<React.SetStateAction<Record<string, { checked: boolean; amount: string }>>>
  lineError: (l: BatchLine) => string | null
  previewByItem: Map<string, DisbursePreview['lines'][number]>
  aggregate: boolean
  setAggregate: (v: boolean) => void
}) {
  if (loading) return <p className="py-6 text-center text-sm text-text-dim">Loading lines…</p>
  if (!payable.length) return <p className="py-6 text-center text-sm text-text-dim">Nothing left to pay on this batch.</p>
  const selectable = payable.filter((l) => l.selectable)
  const allOn = selectable.length > 0 && selectable.every((l) => sel[l.id]?.checked)
  const toggleAll = () =>
    setSel((s) => {
      const n = { ...s }
      for (const l of selectable) n[l.id] = { ...(n[l.id] ?? { amount: amountString(l.outstanding) }), checked: !allOn }
      return n
    })
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--gold)]" checked={allOn} onChange={toggleAll} disabled={!selectable.length} />
          Select all payable ({selectable.length})
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--gold)]" checked={aggregate} onChange={(e) => setAggregate(e.target.checked)} />
          Pay as one transfer per vendor
        </label>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {payable.map((l) => {
          const s = sel[l.id]
          const err = lineError(l)
          const p = previewByItem.get(l.id)
          const partial = s?.checked && !err && kobo(parseAmount(s.amount)) < kobo(l.outstanding)
          return (
            <li key={l.id} className={cn('flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center', !l.selectable && 'opacity-60')}>
              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--gold)]"
                  disabled={!l.selectable}
                  checked={!!s?.checked && l.selectable}
                  onChange={(e) => setSel((x) => ({ ...x, [l.id]: { amount: x[l.id]?.amount ?? amountString(l.outstanding), checked: e.target.checked } }))}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">{l.vendorName}</span>
                  <span className="block truncate text-xs text-text-dim">{l.description}</span>
                  <span className="block text-[11px] text-text-muted">
                    {l.vendorBank ?? 'No bank'} · {l.vendorAcctNo ?? 'no account'} · outstanding {nairaExact(l.outstanding)}
                    {Number(l.whtAmount) > 0 && ` · WHT ${naira(l.whtAmount)}`}
                  </span>
                  {!l.selectable && l.unsafeReason && <span className="mt-0.5 block text-xs font-medium text-orange">{l.unsafeReason}</span>}
                  {p && p.status !== 'OK' && s?.checked && (
                    <span className={cn('mt-0.5 block text-xs font-medium', p.status === 'BLOCKED' ? 'text-red' : 'text-orange')}>{p.message}</span>
                  )}
                </span>
              </label>
              <div className="flex items-center gap-2 pl-6 sm:w-48 sm:pl-0">
                <div className="relative w-full">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-dim">₦</span>
                  <input
                    inputMode="decimal"
                    disabled={!l.selectable || !s?.checked}
                    value={s?.amount ?? ''}
                    onChange={(e) => setSel((x) => ({ ...x, [l.id]: { checked: true, amount: e.target.value } }))}
                    className={cn(
                      'h-9 w-full rounded-lg border border-input bg-card pl-7 pr-2 text-right font-mono text-sm tabular-nums focus:border-gold focus:outline-none disabled:opacity-50',
                      err && 'border-red',
                    )}
                    aria-label={`Amount for ${l.vendorName}`}
                  />
                  {err && <span className="mt-0.5 block text-right text-[11px] text-red">{err}</span>}
                  {partial && <span className="mt-0.5 block text-right text-[10px] font-semibold uppercase tracking-wider text-orange">Part payment</span>}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {hiddenCount > 0 && <p className="text-xs text-text-muted">{hiddenCount} paid or cancelled line{hiddenCount === 1 ? '' : 's'} not shown.</p>}
    </div>
  )
}

function TotalsPanel({
  preview,
  loading,
  nothingSelected,
  anyLineError,
  whtBlockedCount,
}: {
  preview?: DisbursePreview
  loading: boolean
  nothingSelected: boolean
  anyLineError: boolean
  whtBlockedCount: number
}) {
  return (
    <div className="mt-4 space-y-3">
      {whtBlockedCount > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-red/40 bg-red/10 px-3 py-2.5 text-sm text-red">
          <XCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">WHT destination account not set</p>
            <p>
              {whtBlockedCount} selected line{whtBlockedCount === 1 ? ' carries' : 's carry'} withholding tax. WHT payments are blocked until an admin sets
              the WHT destination account. Untick {whtBlockedCount === 1 ? 'it' : 'them'} to pay the rest.
            </p>
            <Link to="/app/settings#wht-account" className="mt-1 inline-block font-semibold underline">
              Settings → WHT destination account
            </Link>
          </div>
        </div>
      )}
      <div className="grid gap-3 rounded-xl border border-border bg-secondary/50 p-4 sm:grid-cols-3">
        <div>
          <MicroLabel>Total to disburse</MicroLabel>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-gold">
            {nothingSelected ? '₦0' : loading || !preview ? <Loader2 size={18} className="mt-1 animate-spin" /> : nairaExact(preview.total)}
          </p>
          {preview && preview.whtTotal > 0 && (
            <p className="text-xs text-text-dim">incl. {nairaExact(preview.whtTotal)} WHT (sent separately)</p>
          )}
        </div>
        <div>
          <MicroLabel>Ready to send now</MicroLabel>
          <p className="mt-1 text-lg font-semibold tabular-nums">{preview ? naira(preview.readyToSend) : '—'}</p>
          {preview && preview.clearing > 0 && <p className="text-xs text-text-dim">{naira(preview.clearing)} clearing</p>}
        </div>
        <div>
          <MicroLabel>Transfers</MicroLabel>
          <p className="mt-1 text-lg font-semibold tabular-nums">{preview ? preview.transfers : '—'}</p>
          {preview && <p className="text-xs text-text-dim">{preview.lines.filter((l) => l.status === 'OK').length} lines</p>}
        </div>
      </div>
      {preview && preview.shortBy > 0 && (
        <div className="rounded-xl border border-red/40 bg-red/10 px-3 py-2.5 text-sm text-red">
          <span className="font-semibold">{naira(preview.shortBy)} short</span> — this will not go through yet. Top up the wallet or pay fewer lines.
        </div>
      )}
      {preview && preview.lines.some((l) => l.status === 'SKIPPED') && (
        <p className="text-xs text-orange">Lines without bank details will be marked “Skipped — missing bank details” and not paid.</p>
      )}
      {anyLineError && <p className="text-xs text-red">Fix the highlighted amounts.</p>}
      {preview && preview.errors.length > 0 && whtBlockedCount === 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-red">
          {preview.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

const RESULT_STYLE: Record<LineResultLabel, { cls: string; icon: typeof CheckCircle2 }> = {
  PAID: { cls: 'text-green', icon: CheckCircle2 },
  FAILED: { cls: 'text-red', icon: XCircle },
  SKIPPED: { cls: 'text-orange', icon: AlertTriangle },
  AWAITING_CONFIRMATION: { cls: 'text-purple', icon: Clock },
}

function ResultView({ result, awaitingPollStopped }: { result: DisburseResult; awaitingPollStopped: boolean }) {
  const s = result.summary
  return (
    <div className="space-y-4">
      {result.recovered && (
        <p className="rounded-xl border border-blue/40 bg-blue/10 px-3 py-2 text-sm text-blue">Recovered from the payout ledger — nothing was sent twice.</p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Paid" value={`${s.paid}`} sub={naira(s.paidAmount)} cls="text-green" />
        <Stat label="Failed — not paid" value={`${s.failed}`} sub={naira(s.failedAmount)} cls="text-red" />
        <Stat label="Skipped" value={`${s.skipped}`} sub="missing bank details" cls="text-orange" />
        <Stat label="Awaiting" value={`${s.awaiting}`} sub={naira(s.awaitingAmount)} cls="text-purple" />
      </div>
      {!result.complete && (
        <div className="flex items-start gap-2 rounded-xl border border-purple/40 bg-purple/10 px-3 py-2.5 text-sm text-purple">
          <Clock size={16} className="mt-0.5 shrink-0" />
          <span>
            {awaitingPollStopped
              ? 'Some transfers are still awaiting confirmation from Monnify. Those lines stay locked so they cannot be paid twice — use Check status later.'
              : 'Waiting for Monnify to confirm some transfers…'}
          </span>
        </div>
      )}
      <ul className="divide-y divide-border rounded-xl border border-border">
        {result.lines.map((l) => {
          const st = RESULT_STYLE[l.result]
          const Icon = st.icon
          return (
            <li key={l.itemId} className="flex items-start gap-3 px-3 py-2.5">
              <Icon size={16} className={cn('mt-0.5 shrink-0', st.cls)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{l.vendorName}</span>
                  <span className="font-mono text-sm tabular-nums">{nairaExact(l.amount)}</span>
                </div>
                <p className={cn('text-xs font-semibold', st.cls)}>{l.label}</p>
                {l.message && <p className="text-xs text-text-dim">{l.message}</p>}
                {l.references.length > 0 && <p className="truncate font-mono text-[10px] text-text-muted">{l.references.join(' · ')}</p>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Stat({ label, value, sub, cls }: { label: string; value: string; sub: string; cls: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/50 p-3">
      <MicroLabel>{label}</MicroLabel>
      <p className={cn('mt-1 text-xl font-bold tabular-nums', cls)}>{value}</p>
      <p className="text-xs text-text-dim tabular-nums">{sub}</p>
    </div>
  )
}
