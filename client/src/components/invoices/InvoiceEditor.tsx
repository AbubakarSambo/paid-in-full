import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { apiError, invCustomersApi, invoiceSettingsApi, invoicesApi, productsApi } from '@/lib/api/invoicing'
import type { DiscountType, DocType, InvCustomer, Invoice, InvoiceInput } from '@/types/invoicing'
import { CustomerFormDialog } from './CustomerFormDialog'
import { CancelButton, Dialog, Field, Segmented, Toggle, isoDay, money, num, optNum, optStr } from './shared'

interface Line {
  key: string
  productId: string
  description: string
  quantity: string
  unitPrice: string
  vatRate: string
  whtRate: string
}

const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR']
let keySeq = 0
const nextKey = () => `l${++keySeq}`

/**
 * Client-side preview of the server's computeInvoiceTotals (api/src/modules/invoices/invoice-calc.util.ts).
 * The server recomputes on save and its figures are authoritative.
 */
function previewTotals(lines: Line[], taxInclusive: boolean, discountType: DiscountType | '', discountValue: number) {
  const prelim = lines.map((l) => {
    const gross = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)
    const vat = Math.max(0, Number(l.vatRate) || 0)
    const wht = Math.max(0, Number(l.whtRate) || 0)
    return { gross, net: taxInclusive ? gross / (1 + vat / 100) : gross, vat, wht }
  })
  const subtotal = prelim.reduce((s, l) => s + l.net, 0)
  const dv = Math.max(0, discountValue || 0)
  const discount = discountType === 'PERCENT' ? subtotal * (Math.min(dv, 100) / 100) : discountType === 'FLAT' ? Math.min(dv, subtotal) : 0
  const factor = subtotal > 0 ? (subtotal - discount) / subtotal : 0
  let vat = 0
  let wht = 0
  for (const l of prelim) {
    vat += l.net * factor * (l.vat / 100)
    wht += l.net * factor * (l.wht / 100)
  }
  const total = subtotal - discount + vat
  return { subtotal, discount, vat, wht, total, amountDue: Math.max(0, total - wht), lineTotals: prelim.map((l) => l.gross) }
}

export function InvoiceEditor({
  open,
  onClose,
  invoice,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** A draft to edit; omit to create. */
  invoice?: Invoice | null
  onSaved: (inv: Invoice) => void
}) {
  const qc = useQueryClient()
  const editing = !!invoice
  const { data: settings } = useQuery({ queryKey: ['invoice-settings'], queryFn: invoiceSettingsApi.get, enabled: open })
  const { data: customersPage } = useQuery({
    queryKey: ['inv-customers', 'picker'],
    queryFn: () => invCustomersApi.list({ status: 'active', limit: 100 }),
    enabled: open,
  })
  const { data: productsPage } = useQuery({
    queryKey: ['products', 'picker'],
    queryFn: () => productsApi.list({ active: true, limit: 100 }),
    enabled: open,
  })
  const customers = customersPage?.data ?? []
  const products = productsPage?.data ?? []
  const defaultVat = settings ? (settings.vatOnNewInvoices ? settings.defaultVatRate || 7.5 : 0) : 7.5

  const blankLine = (): Line => ({ key: nextKey(), productId: '', description: '', quantity: '1', unitPrice: '', vatRate: String(defaultVat), whtRate: '0' })

  const [customerId, setCustomerId] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerTin, setCustomerTin] = useState('')
  const [workspaceTin, setWorkspaceTin] = useState('')
  const [issueDate, setIssueDate] = useState(isoDay())
  const [dueMode, setDueMode] = useState<'days' | 'date'>('days')
  const [dueDays, setDueDays] = useState('14')
  const [dueDate, setDueDate] = useState('')
  const [quoteExpiresAt, setQuoteExpiresAt] = useState('')
  const [currency, setCurrency] = useState('NGN')
  const [fxRate, setFxRate] = useState('')
  const [fxBase, setFxBase] = useState('NGN')
  const [taxInclusive, setTaxInclusive] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [discountType, setDiscountType] = useState<DiscountType | ''>('')
  const [discountValue, setDiscountValue] = useState('')
  const [lateFeePercent, setLateFeePercent] = useState('')
  const [lateFeeFlat, setLateFeeFlat] = useState('')
  const [lateFeeGraceDays, setLateFeeGraceDays] = useState('')
  const [earlyPct, setEarlyPct] = useState('')
  const [earlyDays, setEarlyDays] = useState('')
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('')
  const [addCustomerOpen, setAddCustomerOpen] = useState(false)
  const [initialised, setInitialised] = useState(false)

  // Initialise from the draft being edited, or from workspace defaults once settings load.
  useEffect(() => {
    if (!open) {
      setInitialised(false)
      return
    }
    if (initialised) return
    if (invoice) {
      setCustomerId(invoice.customerId)
      setCustomerAddress(invoice.customerAddress ?? '')
      setCustomerTin(invoice.customerTin ?? '')
      setWorkspaceTin(invoice.workspaceTin ?? '')
      setIssueDate(isoDay(invoice.issueDate))
      if (invoice.dueDays != null) {
        setDueMode('days')
        setDueDays(String(invoice.dueDays))
      } else {
        setDueMode('date')
        setDueDate(invoice.dueDate ? isoDay(invoice.dueDate) : '')
      }
      setQuoteExpiresAt(invoice.quoteExpiresAt ? isoDay(invoice.quoteExpiresAt) : '')
      setCurrency(invoice.currency)
      setFxRate(invoice.fxRate != null ? String(num(invoice.fxRate)) : '')
      setFxBase(invoice.fxBaseCurrency ?? 'NGN')
      setTaxInclusive(invoice.taxInclusive)
      setLines(
        (invoice.items ?? []).map((it) => ({
          key: nextKey(),
          productId: it.productId ?? '',
          description: it.description,
          quantity: String(num(it.quantity)),
          unitPrice: String(num(it.unitPrice)),
          vatRate: String(num(it.vatRate)),
          whtRate: String(num(it.whtRate)),
        })),
      )
      setDiscountType(invoice.discountType ?? '')
      setDiscountValue(invoice.discountType ? String(num(invoice.discountValue)) : '')
      setLateFeePercent(invoice.lateFeePercent != null ? String(num(invoice.lateFeePercent)) : '')
      setLateFeeFlat(invoice.lateFeeFlat != null ? String(num(invoice.lateFeeFlat)) : '')
      setLateFeeGraceDays(invoice.lateFeeGraceDays != null ? String(invoice.lateFeeGraceDays) : '')
      setEarlyPct(invoice.earlyPayDiscountPercent != null ? String(num(invoice.earlyPayDiscountPercent)) : '')
      setEarlyDays(invoice.earlyPayDiscountDays != null ? String(invoice.earlyPayDiscountDays) : '')
      setNotes(invoice.notes ?? '')
      setTerms(invoice.terms ?? '')
      setInitialised(true)
      return
    }
    if (!settings) return
    setCustomerId('')
    setCustomerAddress('')
    setCustomerTin('')
    setWorkspaceTin(settings.workspaceTin ?? '')
    setIssueDate(isoDay())
    setDueMode('days')
    setDueDays('14')
    setDueDate('')
    setQuoteExpiresAt('')
    setCurrency('NGN')
    setFxRate('')
    setFxBase('NGN')
    setTaxInclusive(false)
    setLines([{ key: nextKey(), productId: '', description: '', quantity: '1', unitPrice: '', vatRate: String(defaultVat), whtRate: '0' }])
    setDiscountType('')
    setDiscountValue('')
    setLateFeePercent('')
    setLateFeeFlat('')
    setLateFeeGraceDays('')
    setEarlyPct('')
    setEarlyDays('')
    setNotes('')
    setTerms(settings.defaultTerms ?? '')
    setInitialised(true)
  }, [open, invoice, settings, initialised, defaultVat])

  const pickCustomer = (id: string, list: InvCustomer[] = customers) => {
    setCustomerId(id)
    const c = list.find((x) => x.id === id)
    if (c) {
      setCustomerAddress(c.address ?? '')
      setCustomerTin(c.taxId ?? '')
    }
  }

  const updateLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const pickProduct = (key: string, productId: string) => {
    const p = products.find((x) => x.id === productId)
    updateLine(
      key,
      p
        ? { productId, description: p.name, unitPrice: String(num(p.unitPrice)), vatRate: String(num(p.taxRate)) }
        : { productId: '' },
    )
  }

  const totals = useMemo(
    () => previewTotals(lines, taxInclusive, discountType, Number(discountValue) || 0),
    [lines, taxInclusive, discountType, discountValue],
  )

  const lineErrors = lines.map((l) => {
    if (!l.description.trim() && !l.productId) return 'Description or product required'
    if (!(Number(l.quantity) > 0)) return 'Quantity must be above 0'
    if (l.unitPrice.trim() === '' || Number(l.unitPrice) < 0) return 'Unit price required'
    const v = Number(l.vatRate)
    const w = Number(l.whtRate)
    if (v < 0 || v > 100 || w < 0 || w > 100) return 'Rates must be 0–100'
    return null
  })
  const valid = !!customerId && lines.length > 0 && lineErrors.every((e) => !e) && (dueMode === 'days' ? dueDays.trim() !== '' : !!dueDate)

  const buildPayload = (docType: DocType, issue: boolean): InvoiceInput => ({
    ...(editing ? {} : { docType }),
    issue,
    customerId,
    customerAddress: customerAddress.trim(),
    customerTin: customerTin.trim(),
    workspaceTin: workspaceTin.trim(),
    issueDate,
    ...(dueMode === 'days' ? { dueDays: Number(dueDays) } : { dueDate }),
    ...(docType === 'QUOTE' && quoteExpiresAt ? { quoteExpiresAt } : {}),
    currency,
    ...(currency !== 'NGN' && fxRate ? { fxRate: Number(fxRate), fxBaseCurrency: fxBase } : {}),
    taxInclusive,
    items: lines.map((l) => ({
      productId: l.productId || undefined,
      description: optStr(l.description),
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      vatRate: Number(l.vatRate) || 0,
      whtRate: Number(l.whtRate) || 0,
    })),
    discountType: discountType || null,
    discountValue: discountType ? Number(discountValue) || 0 : 0,
    lateFeePercent: optNum(lateFeePercent),
    lateFeeFlat: optNum(lateFeeFlat),
    lateFeeGraceDays: optNum(lateFeeGraceDays),
    earlyPayDiscountPercent: optNum(earlyPct),
    earlyPayDiscountDays: optNum(earlyDays),
    notes: notes.trim(),
    terms: terms.trim() || undefined,
  })

  const save = useMutation({
    mutationFn: ({ docType, issue }: { docType: DocType; issue: boolean }) => {
      const body = buildPayload(docType, issue)
      return invoice ? invoicesApi.update(invoice.id, body) : invoicesApi.create(body)
    },
    onSuccess: (inv, { issue }) => {
      const label = inv.docType === 'QUOTE' ? 'Quote' : 'Invoice'
      toast.success(`${label} ${inv.number ?? ''} ${issue ? 'issued' : 'saved'} · amount due ${money(inv.amountDue, inv.currency)}`)
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['invoice-summary'] })
      qc.setQueryData(['invoice', inv.id], inv)
      onSaved(inv)
    },
    onError: (e) => toast.error(apiError(e, 'Could not save')),
  })

  const docType: DocType = invoice?.docType ?? 'INVOICE'
  const isQuote = docType === 'QUOTE'
  const cur = currency

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="full"
        title={editing ? `Edit ${isQuote ? 'quote' : 'invoice'} ${invoice?.number ?? ''}` : 'New invoice'}
        description="Totals preview live; the server recalculates on save."
        footer={
          <>
            <CancelButton onClick={onClose} />
            {!editing && (
              <Button
                variant="outline"
                size="sm"
                disabled={!valid || save.isPending}
                onClick={() => save.mutate({ docType: 'QUOTE', issue: false })}
              >
                Save as Quote
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate({ docType, issue: false })}>
              Save Draft
            </Button>
            <Button size="sm" disabled={!valid} isLoading={save.isPending} onClick={() => save.mutate({ docType, issue: true })}>
              Save &amp; Issue
            </Button>
          </>
        }
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6 min-w-0">
            {/* Customer + dates */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer" className="sm:col-span-2">
                <div className="flex gap-2">
                  <Select value={customerId} onChange={(e) => pickCustomer(e.target.value)}>
                    <option value="">Select a customer…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.email ? ` · ${c.email}` : ''}
                      </option>
                    ))}
                    {invoice?.customer && !customers.some((c) => c.id === invoice.customerId) && (
                      <option value={invoice.customerId}>{invoice.customer.name}</option>
                    )}
                  </Select>
                  <Button type="button" variant="outline" size="sm" className="h-11 shrink-0" onClick={() => setAddCustomerOpen(true)}>
                    <UserPlus size={14} /> <span className="hidden sm:inline">Add new customer</span>
                  </Button>
                </div>
              </Field>
              <Field label="Billing address" className="sm:col-span-2">
                <Textarea rows={2} value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
              </Field>
              <Field label="Issue date">
                <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </Field>
              <Field label="Due">
                <div className="flex gap-2">
                  <Segmented
                    value={dueMode}
                    onChange={setDueMode}
                    options={[
                      { value: 'days', label: 'In days' },
                      { value: 'date', label: 'Date' },
                    ]}
                  />
                  {dueMode === 'days' ? (
                    <Input type="number" min={0} value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
                  ) : (
                    <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  )}
                </div>
              </Field>
              {isQuote && (
                <Field label="Quote expires" hint="Defaults to 30 days after issue">
                  <Input type="date" value={quoteExpiresAt} onChange={(e) => setQuoteExpiresAt(e.target.value)} />
                </Field>
              )}
              <Field label="Currency">
                <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              {currency !== 'NGN' && (
                <Field label={`FX rate (1 ${currency} = ? ${fxBase})`}>
                  <div className="flex gap-2">
                    <Input type="number" min={0} step="any" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="1550" />
                    <Select value={fxBase} onChange={(e) => setFxBase(e.target.value)} className="w-24">
                      {CURRENCIES.filter((c) => c !== currency).map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </div>
                </Field>
              )}
              <div className="flex items-end pb-2">
                <Toggle checked={taxInclusive} onChange={setTaxInclusive} label="Prices include VAT (tax-inclusive)" />
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">Line items</h4>
                <span className="text-xs text-text-muted">New lines default to {defaultVat}% VAT</span>
              </div>
              <div className="space-y-3">
                {lines.map((l, i) => (
                  <div key={l.key} className="rounded-xl border border-border bg-surface2/40 p-3">
                    <div className="grid gap-2 sm:grid-cols-12">
                      <div className="sm:col-span-4">
                        <Select value={l.productId} onChange={(e) => pickProduct(l.key, e.target.value)} className="h-10">
                          <option value="">Custom item</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} · {money(p.unitPrice)}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="sm:col-span-8">
                        <Input
                          className="h-10"
                          placeholder="Description"
                          value={l.description}
                          onChange={(e) => updateLine(l.key, { description: e.target.value })}
                        />
                      </div>
                      <LineNum label="Qty" value={l.quantity} onChange={(v) => updateLine(l.key, { quantity: v })} />
                      <LineNum label="Unit price" value={l.unitPrice} onChange={(v) => updateLine(l.key, { unitPrice: v })} wide />
                      <LineNum label="VAT %" value={l.vatRate} onChange={(v) => updateLine(l.key, { vatRate: v })} />
                      <LineNum label="WHT %" value={l.whtRate} onChange={(v) => updateLine(l.key, { whtRate: v })} />
                      <div className="flex items-end justify-between gap-2 sm:col-span-4">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-text-muted">Line total</div>
                          <div className="font-semibold tabular-nums">{money(totals.lineTotals[i], cur)}</div>
                        </div>
                        <button
                          type="button"
                          className="rounded-lg p-2 text-text-dim hover:bg-red/10 hover:text-red disabled:opacity-30"
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                          disabled={lines.length === 1}
                          aria-label="Remove line"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    {lineErrors[i] && (l.unitPrice !== '' || l.description !== '') && (
                      <p className="mt-1 text-xs text-red">{lineErrors[i]}</p>
                    )}
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setLines((ls) => [...ls, blankLine()])}>
                <Plus size={14} /> Add line
              </Button>
            </div>

            {/* Adjustments */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Invoice discount">
                <div className="flex gap-2">
                  <Select value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountType | '')} className="w-32">
                    <option value="">None</option>
                    <option value="PERCENT">Percent</option>
                    <option value="FLAT">Flat</option>
                  </Select>
                  <Input
                    type="number"
                    min={0}
                    disabled={!discountType}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder={discountType === 'PERCENT' ? '%' : 'Amount'}
                  />
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Workspace TIN">
                  <Input value={workspaceTin} onChange={(e) => setWorkspaceTin(e.target.value)} />
                </Field>
                <Field label="Customer TIN">
                  <Input value={customerTin} onChange={(e) => setCustomerTin(e.target.value)} />
                </Field>
              </div>
              <Field label="Late fee" hint="Applied once after the due date plus grace days">
                <div className="grid grid-cols-3 gap-2">
                  <Input type="number" min={0} max={100} placeholder="%" value={lateFeePercent} onChange={(e) => setLateFeePercent(e.target.value)} />
                  <Input type="number" min={0} placeholder="Flat ₦" value={lateFeeFlat} onChange={(e) => setLateFeeFlat(e.target.value)} />
                  <Input type="number" min={0} placeholder="Grace days" value={lateFeeGraceDays} onChange={(e) => setLateFeeGraceDays(e.target.value)} />
                </div>
              </Field>
              <Field label="Early-payment discount" hint="% off when paid in full within N days of issue">
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" min={0} max={100} placeholder="%" value={earlyPct} onChange={(e) => setEarlyPct(e.target.value)} />
                  <Input type="number" min={0} placeholder="Within N days" value={earlyDays} onChange={(e) => setEarlyDays(e.target.value)} />
                </div>
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <Field label="Terms" className="sm:col-span-2">
                <Textarea rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} />
              </Field>
            </div>
          </div>

          {/* Totals */}
          <aside className="lg:sticky lg:top-0 h-fit rounded-2xl border border-border bg-surface2/50 p-4">
            <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">Totals</h4>
            <dl className="space-y-2 text-sm">
              <Row label={taxInclusive ? 'Subtotal (ex VAT)' : 'Subtotal'} value={money(totals.subtotal, cur)} />
              {totals.discount > 0 && <Row label="Discount" value={`− ${money(totals.discount, cur)}`} />}
              <Row label="VAT" value={money(totals.vat, cur)} />
              <Row label="Total" value={money(totals.total, cur)} strong />
              {totals.wht > 0 && <Row label="Less WHT" value={`− ${money(totals.wht, cur)}`} />}
            </dl>
            <div className="mt-4 border-t border-border pt-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-dim">Amount due</div>
              <div className="text-3xl font-bold tabular-nums text-gold">{money(totals.amountDue, cur)}</div>
              {editing && (
                <p className="mt-2 text-xs text-text-muted">Last saved by server: {money(invoice?.amountDue, invoice?.currency)}</p>
              )}
            </div>
          </aside>
        </div>
      </Dialog>
      <CustomerFormDialog
        open={addCustomerOpen}
        onClose={() => setAddCustomerOpen(false)}
        onSaved={(c) => {
          qc.setQueryData(['inv-customers', 'picker'], (old: typeof customersPage) =>
            old ? { ...old, data: [...old.data, c].sort((a, b) => a.name.localeCompare(b.name)) } : old,
          )
          pickCustomer(c.id, [...customers, c])
        }}
      />
    </>
  )
}

function LineNum({ label, value, onChange, wide }: { label: string; value: string; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <label className={wide ? 'sm:col-span-3' : 'sm:col-span-2 max-sm:inline-block'}>
      <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      <Input className="h-10 tabular-nums" type="number" min={0} step="any" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-text-dim">{label}</dt>
      <dd className={strong ? 'font-bold tabular-nums' : 'tabular-nums'}>{value}</dd>
    </div>
  )
}
