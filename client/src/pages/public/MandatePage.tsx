import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Building2, CheckCircle2, CreditCard, Loader2, Lock, XCircle } from 'lucide-react'
import { FALLBACK_BANKS, apiError, apiStatus, publicInvoicingApi } from '@/lib/api/invoicing'
import type { AuthoriseMandateResult, PublicMandate, RecurrenceInterval } from '@/types/invoicing'

// Public, light-themed page (explicit colours, independent of the app theme).
const FREQ: Record<RecurrenceInterval, string> = { WEEKLY: 'week', MONTHLY: 'month', QUARTERLY: 'quarter', ANNUALLY: 'year' }
const ngn = (v: number) => `₦${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format(Math.round(v || 0))}`
const fmtDate = (v: string) => new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(v))
const ACCENT = '#F4B942'

export default function MandatePage() {
  const { token = '' } = useParams()
  const [params] = useSearchParams()
  // Monnify sends the customer back here after card checkout (paymentReference in the query).
  const returnedFromCheckout = params.has('paymentReference') || params.has('transactionReference')
  const [pollUntil] = useState(() => (returnedFromCheckout ? Date.now() + 60_000 : 0))

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['public-mandate', token],
    queryFn: () => publicInvoicingApi.mandate(token),
    retry: (n, e) => apiStatus(e) !== 404 && n < 2,
    refetchInterval: (q) => (q.state.data?.status === 'PENDING_MANDATE' && Date.now() < pollUntil ? 3000 : false),
  })

  return (
    <div className="min-h-screen bg-[#F3F2EE] px-3 py-8 text-[#1A1813] sm:py-14" style={{ colorScheme: 'light' }}>
      <div className="mx-auto max-w-md">
        {isLoading ? (
          <Card>
            <p className="py-10 text-center text-sm text-[#6B6656]">Loading…</p>
          </Card>
        ) : error || !data ? (
          <Card>
            <State icon={<XCircle className="text-[#DC2626]" size={40} />} title="Link not available">
              {apiStatus(error) === 404 ? 'This authorisation link is invalid or has expired.' : apiError(error, 'Please try again later.')}
            </State>
          </Card>
        ) : (
          <MandateBody m={data} token={token} awaitingCard={returnedFromCheckout && Date.now() < pollUntil} onRefresh={() => refetch()} />
        )}
        <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-[#6B6656]">
          <Lock size={12} /> Secured by Monnify
        </p>
      </div>
    </div>
  )
}

function MandateBody({ m, token, awaitingCard, onRefresh }: { m: PublicMandate; token: string; awaitingCard: boolean; onRefresh: () => void }) {
  const [method, setMethod] = useState<'CARD' | 'DIRECT_DEBIT' | null>(null)
  const [result, setResult] = useState<AuthoriseMandateResult | null>(null)

  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-[#EEEBE2] pb-4">
        {m.merchant.logoUrl ? (
          <img src={m.merchant.logoUrl} alt={m.merchant.name} className="h-10 w-10 rounded-lg object-contain" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg font-bold text-[#14120C]" style={{ background: ACCENT }}>
            {m.merchant.name.charAt(0)}
          </div>
        )}
        <div>
          <div className="text-xs text-[#6B6656]">Auto-debit authorisation for</div>
          <div className="font-semibold">{m.merchant.name}</div>
        </div>
      </div>

      <div className="py-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9C9585]">{m.planName ?? 'Subscription'}</div>
        <div className="mt-1 text-3xl font-bold tabular-nums">
          {ngn(m.amount)} <span className="text-base font-medium text-[#6B6656]">/ {FREQ[m.frequency]}</span>
        </div>
        {m.description && <p className="mt-2 text-sm text-[#4A463B]">{m.description}</p>}
        <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-[#6B6656]">Customer</dt>
          <dd className="text-right">{m.customer.name}</dd>
          <dt className="text-[#6B6656]">First charge</dt>
          <dd className="text-right">{fmtDate(m.firstChargeDate)}</dd>
        </dl>
      </div>

      {m.status === 'ACTIVE' ? (
        <State icon={<CheckCircle2 className="text-[#22A559]" size={40} />} title="Auto-debit authorised">
          {m.mandateType === 'CARD' && m.cardLast4 ? `Card ending ${m.cardLast4} will be charged ` : 'Your account will be debited '}
          {ngn(m.amount)} every {FREQ[m.frequency]}. You can close this page.
        </State>
      ) : m.status === 'CANCELLED' ? (
        <State icon={<XCircle className="text-[#DC2626]" size={40} />} title="Subscription cancelled">
          This plan has been cancelled by {m.merchant.name}. No further charges will be made.
        </State>
      ) : result?.status === 'PENDING_BANK_APPROVAL' ? (
        <State icon={<Loader2 className="animate-spin text-[#B8860B]" size={40} />} title="Waiting for your bank">
          Your bank needs to approve the direct debit.
          {result.authorizationLink && (
            <>
              {' '}
              <a href={result.authorizationLink} className="font-semibold underline" target="_blank" rel="noreferrer">
                Complete the approval
              </a>
              .
            </>
          )}
          <button onClick={onRefresh} className="mt-3 block w-full rounded-full border border-[#DDD8CA] py-2 text-sm font-semibold">
            Check status
          </button>
        </State>
      ) : awaitingCard ? (
        <State icon={<Loader2 className="animate-spin text-[#B8860B]" size={40} />} title="Confirming your card">
          We’re confirming the {ngn(m.cardVerificationAmount)} verification payment. This takes a few seconds.
        </State>
      ) : method === null ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold">Choose how you’d like to pay</p>
          <Option icon={<CreditCard size={20} />} title="Debit card" onClick={() => setMethod('CARD')}>
            A one-time {ngn(m.cardVerificationAmount)} verification charge confirms your card.
          </Option>
          <Option icon={<Building2 size={20} />} title="Bank direct debit" onClick={() => setMethod('DIRECT_DEBIT')}>
            Authorise debits straight from your bank account.
          </Option>
        </div>
      ) : method === 'CARD' ? (
        <CardForm m={m} token={token} onBack={() => setMethod(null)} />
      ) : (
        <DirectDebitForm m={m} token={token} onBack={() => setMethod(null)} onDone={(r) => (setResult(r), onRefresh())} />
      )}
    </Card>
  )
}

function CardForm({ m, token, onBack }: { m: PublicMandate; token: string; onBack: () => void }) {
  const [email, setEmail] = useState(m.customer.email ?? '')
  const needsEmail = !m.customer.email
  const emailOk = !needsEmail || /^\S+@\S+\.\S+$/.test(email.trim())
  const go = useMutation({
    mutationFn: () =>
      publicInvoicingApi.authorise(token, {
        method: 'CARD',
        redirectUrl: `${window.location.origin}/m/${token}`,
        ...(needsEmail ? { email: email.trim() } : {}),
      }),
    onSuccess: (r) => {
      if (r.checkoutUrl) window.location.href = r.checkoutUrl
    },
  })
  return (
    <div className="space-y-3">
      <p className="text-sm text-[#4A463B]">
        You’ll be taken to Monnify’s secure checkout. A {ngn(m.cardVerificationAmount)} verification charge confirms your card; after that{' '}
        {ngn(m.amount)} is charged every {FREQ[m.frequency]}.
      </p>
      {needsEmail && (
        <PField label="Email for your receipt" error={email && !emailOk ? 'Enter a valid email' : undefined}>
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </PField>
      )}
      {go.error && <ErrorNote>{apiError(go.error)}</ErrorNote>}
      <FormButtons
        onBack={onBack}
        onPrimary={() => go.mutate()}
        disabled={!emailOk || go.isPending}
        loading={go.isPending || go.isSuccess}
        label="Continue to card checkout"
      />
    </div>
  )
}

function DirectDebitForm({
  m,
  token,
  onBack,
  onDone,
}: {
  m: PublicMandate
  token: string
  onBack: () => void
  onDone: (r: AuthoriseMandateResult) => void
}) {
  const [f, setF] = useState({ bankCode: '', accountNumber: '', accountName: m.customer.name, phone: digits(m.customer.phone ?? ''), address: m.customer.address ?? '' })
  const [touched, setTouched] = useState(false)
  const errors = {
    bankCode: !f.bankCode ? 'Select your bank' : null,
    accountNumber: !/^\d{10}$/.test(f.accountNumber) ? 'Account number must be 10 digits (NUBAN)' : null,
    phone: !/^\d{11}$/.test(f.phone) ? 'Phone number must be 11 digits' : null,
    address: !f.address.trim() ? 'Address is required' : null,
  }
  const valid = Object.values(errors).every((e) => !e)
  const go = useMutation({
    mutationFn: () =>
      publicInvoicingApi.authorise(token, {
        method: 'DIRECT_DEBIT',
        bankCode: f.bankCode,
        accountNumber: f.accountNumber,
        phone: f.phone,
        address: f.address.trim(),
        accountName: f.accountName.trim() || undefined,
      }),
    onSuccess: onDone,
  })
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  const show = (k: keyof typeof errors) => (touched ? errors[k] ?? undefined : undefined)
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (valid) go.mutate()
      }}
    >
      <PField label="Bank" error={show('bankCode')}>
        <select className={inputCls} value={f.bankCode} onChange={(e) => set('bankCode', e.target.value)}>
          <option value="">Select your bank…</option>
          {FALLBACK_BANKS.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </PField>
      <PField label="Account number" error={show('accountNumber')}>
        <input
          className={inputCls}
          inputMode="numeric"
          maxLength={10}
          value={f.accountNumber}
          onChange={(e) => set('accountNumber', digits(e.target.value).slice(0, 10))}
          placeholder="10-digit NUBAN"
        />
      </PField>
      <PField label="Account name">
        <input className={inputCls} value={f.accountName} onChange={(e) => set('accountName', e.target.value)} />
      </PField>
      <PField label="Phone number" error={show('phone')}>
        <input
          className={inputCls}
          inputMode="tel"
          maxLength={11}
          value={f.phone}
          onChange={(e) => set('phone', digits(e.target.value).slice(0, 11))}
          placeholder="08012345678"
        />
      </PField>
      <PField label="Address" error={show('address')}>
        <textarea className={`${inputCls} h-auto min-h-[70px] py-2`} value={f.address} onChange={(e) => set('address', e.target.value)} />
      </PField>
      <p className="text-xs text-[#6B6656]">
        By continuing you authorise {m.merchant.name} to debit {ngn(m.amount)} every {FREQ[m.frequency]} from this account until you cancel.
      </p>
      {go.error && <ErrorNote>{apiError(go.error)}</ErrorNote>}
      <FormButtons onBack={onBack} submit loading={go.isPending} label="Authorise direct debit" />
    </form>
  )
}

const digits = (s: string) => s.replace(/\D/g, '')
const inputCls =
  'h-11 w-full rounded-xl border border-[#DDD8CA] bg-white px-3 text-[16px] sm:text-sm text-[#1A1813] outline-none focus:border-[#B8860B] focus:ring-2 focus:ring-[#F4B942]/30'

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-white p-6 shadow-sm">{children}</div>
}
function State({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="py-6 text-center">
      <div className="mb-3 flex justify-center">{icon}</div>
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-1 text-sm text-[#4A463B]">{children}</div>
    </div>
  )
}
function Option({ icon, title, children, onClick }: { icon: React.ReactNode; title: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-start gap-3 rounded-xl border border-[#DDD8CA] p-4 text-left hover:border-[#B8860B] hover:bg-[#FFFBF0]">
      <span className="mt-0.5 text-[#B8860B]">{icon}</span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs text-[#6B6656]">{children}</span>
      </span>
    </button>
  )
}
function PField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-[#4A463B]">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-[#DC2626]">{error}</span>}
    </label>
  )
}
function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-[#FDECEC] px-3 py-2 text-sm text-[#B42318]">{children}</p>
}
function FormButtons({
  onBack,
  onPrimary,
  label,
  loading,
  disabled,
  submit,
}: {
  onBack: () => void
  onPrimary?: () => void
  label: string
  loading?: boolean
  disabled?: boolean
  submit?: boolean
}) {
  return (
    <div className="flex gap-2 pt-1">
      <button type="button" onClick={onBack} className="rounded-full border border-[#DDD8CA] px-4 py-2.5 text-sm font-semibold">
        Back
      </button>
      <button
        type={submit ? 'submit' : 'button'}
        onClick={submit ? undefined : onPrimary}
        disabled={disabled || loading}
        className="flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold text-[#14120C] disabled:opacity-50"
        style={{ background: ACCENT }}
      >
        {loading && <Loader2 size={16} className="animate-spin" />}
        {label}
      </button>
    </div>
  )
}
