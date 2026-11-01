import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, Download, Printer } from 'lucide-react'
import { apiError, apiStatus, publicInvoicingApi } from '@/lib/api/invoicing'
import type { PublicInvoice } from '@/types/invoicing'

// Always light and printable, regardless of the app theme. Colours are explicit, not theme tokens.

function fmtMoney(v: number, currency: string) {
  const n = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format(Math.round(v || 0))
  return currency === 'NGN' ? `₦${n}` : `${currency} ${n}`
}
function fmtDate(v: string | null) {
  return v ? new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(v)) : '—'
}
const hex = (c?: string | null) => `#${(c || 'F4B942').replace(/^#/, '')}`

export default function PublicInvoicePage() {
  const { token = '' } = useParams()
  const { data, isLoading, error } = useQuery({
    queryKey: ['public-invoice', token],
    queryFn: () => publicInvoicingApi.invoice(token),
    retry: (count, e) => apiStatus(e) !== 404 && count < 2,
  })

  useEffect(() => {
    if (data) document.title = `${data.docType === 'QUOTE' ? 'Quote' : 'Invoice'} ${data.number ?? ''} · ${data.from.name}`
  }, [data])

  return (
    <div className="min-h-screen bg-[#F3F2EE] px-3 py-6 text-[#1A1813] sm:px-6 sm:py-10 print:bg-white print:p-0" style={{ colorScheme: 'light' }}>
      {isLoading ? (
        <p className="py-24 text-center text-sm text-[#6B6656]">Loading…</p>
      ) : error || !data ? (
        <div className="mx-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-bold">This link isn’t available</h1>
          <p className="mt-2 text-sm text-[#6B6656]">
            {apiStatus(error) === 404 ? 'The invoice was not found or has not been issued yet.' : apiError(error, 'Please try again later.')}
          </p>
        </div>
      ) : (
        <InvoiceDocument inv={data} token={token} />
      )}
    </div>
  )
}

function InvoiceDocument({ inv, token }: { inv: PublicInvoice; token: string }) {
  const accent = hex(inv.branding.themeColor)
  const isQuote = inv.docType === 'QUOTE'
  const t = inv.totals
  const c = inv.currency
  const paidUp = !isQuote && t.balance <= 0 && inv.status === 'PAID'

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex justify-end gap-2 print:hidden">
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#DDD8CA] bg-white px-4 py-2 text-xs font-semibold hover:bg-[#FAF9F6]"
        >
          <Printer size={14} /> Print
        </button>
        <a
          href={publicInvoicingApi.invoicePdfUrl(token)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-[#14120C]"
          style={{ background: accent }}
        >
          <Download size={14} /> Download PDF
        </a>
      </div>

      <article className="overflow-hidden rounded-2xl bg-white shadow-sm print:rounded-none print:shadow-none">
        <div className="h-2" style={{ background: accent }} />
        <div className="space-y-8 p-6 sm:p-10">
          {/* Header */}
          <header className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-2">
              {inv.branding.logoUrl ? (
                <img src={inv.branding.logoUrl} alt={inv.from.name} className="max-h-14 max-w-[180px] object-contain" />
              ) : (
                <div className="text-xl font-bold">{inv.from.name}</div>
              )}
              {inv.branding.logoUrl && <div className="font-semibold">{inv.from.name}</div>}
              {inv.from.tin && <div className="text-xs text-[#6B6656]">TIN {inv.from.tin}</div>}
            </div>
            <div className="text-right">
              <div className="text-xs font-semibold uppercase tracking-[0.15em]" style={{ color: accent }}>
                {isQuote ? 'Quote' : 'Invoice'}
              </div>
              <div className="text-2xl font-bold">{inv.number}</div>
              {inv.status === 'VOID' && <Badge color="#9C9585">Void</Badge>}
              {paidUp && <Badge color="#22A559">Paid</Badge>}
              {inv.status === 'OVERDUE' && <Badge color="#DC2626">Overdue</Badge>}
              {isQuote && inv.isQuoteExpired && <Badge color="#DC2626">Expired</Badge>}
            </div>
          </header>

          {/* Bill to + dates */}
          <section className="grid gap-6 sm:grid-cols-2">
            <div>
              <Label>Bill to</Label>
              <div className="font-semibold">{inv.billTo.name}</div>
              {inv.billTo.address && <div className="whitespace-pre-wrap text-sm text-[#4A463B]">{inv.billTo.address}</div>}
              {inv.billTo.email && <div className="text-sm text-[#4A463B]">{inv.billTo.email}</div>}
              {inv.billTo.phone && <div className="text-sm text-[#4A463B]">{inv.billTo.phone}</div>}
              {inv.billTo.tin && <div className="text-xs text-[#6B6656]">TIN {inv.billTo.tin}</div>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:text-right">
              <dt className="text-[#6B6656]">Issue date</dt>
              <dd>{fmtDate(inv.issueDate)}</dd>
              {isQuote ? (
                <>
                  <dt className="text-[#6B6656]">Valid until</dt>
                  <dd>{fmtDate(inv.quoteExpiresAt)}</dd>
                </>
              ) : (
                <>
                  <dt className="text-[#6B6656]">Due date</dt>
                  <dd>{fmtDate(inv.dueDate)}</dd>
                </>
              )}
              <dt className="text-[#6B6656]">{isQuote ? 'Total' : 'Balance due'}</dt>
              <dd className="text-lg font-bold tabular-nums">{fmtMoney(isQuote ? t.amountDue : t.balance, c)}</dd>
            </dl>
          </section>

          {/* Items */}
          <section className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b-2 text-left text-[10px] uppercase tracking-[0.1em] text-[#6B6656]" style={{ borderColor: accent }}>
                  <th className="py-2">Description</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Unit price</th>
                  <th className="py-2 text-right">VAT</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.items.map((it, i) => (
                  <tr key={i} className="border-b border-[#EEEBE2]">
                    <td className="py-2.5 pr-3">{it.description}</td>
                    <td className="py-2.5 text-right tabular-nums">{it.quantity}</td>
                    <td className="py-2.5 text-right tabular-nums">{fmtMoney(it.unitPrice, c)}</td>
                    <td className="py-2.5 text-right tabular-nums">{it.vatRate}%</td>
                    <td className="py-2.5 text-right tabular-nums">{fmtMoney(it.lineTotal, c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {inv.taxInclusive && <p className="mt-1 text-xs text-[#6B6656]">Prices include VAT.</p>}
          </section>

          {/* Totals */}
          <section className="flex justify-end">
            <dl className="w-full max-w-xs space-y-1.5 text-sm">
              <TRow l="Subtotal" v={fmtMoney(t.subtotal, c)} />
              {t.discount > 0 && (
                <TRow l={`Discount${t.discountType === 'PERCENT' ? ` (${t.discountValue}%)` : ''}`} v={`− ${fmtMoney(t.discount, c)}`} />
              )}
              <TRow l="VAT" v={fmtMoney(t.vat, c)} />
              <TRow l="Total" v={fmtMoney(t.total, c)} strong />
              {t.lessWht > 0 && <TRow l="Less WHT" v={`− ${fmtMoney(t.lessWht, c)}`} />}
              {t.lateFee > 0 && <TRow l="Late fee" v={fmtMoney(t.lateFee, c)} />}
              {t.earlyPayDiscount > 0 && <TRow l="Early-payment discount" v={`− ${fmtMoney(t.earlyPayDiscount, c)}`} />}
              <TRow l="Amount due" v={fmtMoney(t.amountDue, c)} strong />
              {!isQuote && (
                <>
                  <TRow l="Paid" v={fmtMoney(t.paid, c)} />
                  <div className="mt-2 flex justify-between rounded-lg px-3 py-2 font-bold" style={{ background: `${accent}22` }}>
                    <span>Balance</span>
                    <span className="tabular-nums">{fmtMoney(t.balance, c)}</span>
                  </div>
                </>
              )}
            </dl>
          </section>

          {(inv.earlyPay.percent || inv.lateFee.percent || inv.lateFee.flat) && !isQuote && (
            <section className="space-y-1 text-xs text-[#4A463B]">
              {inv.earlyPay.percent ? (
                <p>
                  Pay in full within {inv.earlyPay.days} days of the issue date for a {inv.earlyPay.percent}% discount.
                </p>
              ) : null}
              {inv.lateFee.percent || inv.lateFee.flat ? (
                <p>
                  A late fee of {[inv.lateFee.percent ? `${inv.lateFee.percent}%` : null, inv.lateFee.flat ? fmtMoney(inv.lateFee.flat, c) : null]
                    .filter(Boolean)
                    .join(' + ')}{' '}
                  applies {inv.lateFee.graceDays ? `${inv.lateFee.graceDays} days ` : ''}after the due date.
                </p>
              ) : null}
            </section>
          )}

          {/* Bank details */}
          {inv.bankDetails && !isQuote && t.balance > 0 && inv.status !== 'VOID' && (
            <section className="rounded-xl border border-[#EEEBE2] bg-[#FAF9F6] p-4">
              <Label>Pay by bank transfer</Label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-2xl font-bold tracking-wide tabular-nums">{inv.bankDetails.accountNumber}</span>
                <CopyBtn text={inv.bankDetails.accountNumber} />
              </div>
              <div className="text-sm text-[#4A463B]">
                {inv.bankDetails.bankName}
                {inv.bankDetails.accountName && ` · ${inv.bankDetails.accountName}`}
              </div>
              {inv.bankDetails.type === 'COLLECTION_ACCOUNT' ? (
                <p className="mt-2 text-xs text-[#6B6656]">This account is dedicated to this invoice; your payment is matched automatically.</p>
              ) : (
                <p className="mt-2 text-xs text-[#6B6656]">Please use {inv.number} as your payment reference.</p>
              )}
            </section>
          )}

          {(inv.notes || inv.terms) && (
            <section className="grid gap-6 sm:grid-cols-2">
              {inv.notes && (
                <div>
                  <Label>Notes</Label>
                  <p className="whitespace-pre-wrap text-sm text-[#4A463B]">{inv.notes}</p>
                </div>
              )}
              {inv.terms && (
                <div>
                  <Label>Terms</Label>
                  <p className="whitespace-pre-wrap text-sm text-[#4A463B]">{inv.terms}</p>
                </div>
              )}
            </section>
          )}

          {inv.signatureUrl && (
            <section>
              <img src={inv.signatureUrl} alt="Signature" className="max-h-16 max-w-[200px] object-contain" />
              <div className="mt-1 w-48 border-t border-[#DDD8CA] pt-1 text-xs text-[#6B6656]">Authorised signature</div>
            </section>
          )}

          {inv.branding.footerText && <p className="border-t border-[#EEEBE2] pt-4 text-center text-xs text-[#6B6656]">{inv.branding.footerText}</p>}
        </div>
      </article>
      <p className="mt-4 text-center text-xs text-[#9C9585]">{inv.poweredBy || 'Powered by Paid in Full'}</p>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9C9585]">{children}</div>
}
function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
      style={{ color, borderColor: color }}
    >
      {children}
    </span>
  )
}
function TRow({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'border-t border-[#EEEBE2] pt-1.5 font-bold' : ''}`}>
      <dt className={strong ? '' : 'text-[#6B6656]'}>{l}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  )
}
function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-full border border-[#DDD8CA] bg-white px-3 py-1 text-xs font-semibold print:hidden"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          /* clipboard blocked; number is visible to copy manually */
        }
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />} {done ? 'Copied' : 'Copy'}
    </button>
  )
}
