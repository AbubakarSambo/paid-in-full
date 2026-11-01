import axios from 'axios'
import { api } from '@/lib/api'
import type {
  AuthoriseMandateInput,
  AuthoriseMandateResult,
  Bank,
  ClientSubscription,
  CreditStatus,
  CreditsPage,
  CustomerCredit,
  CustomerInput,
  InvCustomer,
  Invoice,
  InvoiceFilters,
  InvoiceInput,
  InvoiceRecurrence,
  InvoiceSend,
  InvoiceSettings,
  InvoiceSettingsInput,
  InvoiceSummary,
  InvoiceTemplate,
  Page,
  PaymentAccount,
  Product,
  ProductInput,
  PublicInvoice,
  PublicMandate,
  RecordPaymentInput,
  RecordPaymentResult,
  RecurrenceInput,
  RecurrenceInterval,
  RecurrenceRunResult,
  SendInvoiceInput,
  SendInvoiceResult,
  SubscriptionCharge,
  SubscriptionInput,
  SubscriptionStatus,
  SweepSettings,
} from '@/types/invoicing'

const d = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data)

/** Pulls a human message out of an API error ({ message } may be a string or a validation array). */
export function apiError(err: unknown, fallback = 'Something went wrong'): string {
  const e = err as { response?: { data?: { message?: unknown } }; message?: string }
  const m = e?.response?.data?.message
  if (Array.isArray(m)) return m.join(', ')
  if (typeof m === 'string' && m) return m
  return e?.message || fallback
}
export const apiStatus = (err: unknown) => (err as { response?: { status?: number } })?.response?.status

// ─── Public (no auth) ──────────────────────────────────────────────────────
// A separate instance: no Authorization header and no 401 → /login redirect.
export const publicBaseURL = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`
const publicApi = axios.create({ baseURL: publicBaseURL })
publicApi.interceptors.response.use((res) => {
  if (res.data && typeof res.data === 'object' && res.data.success === true && 'data' in res.data) res.data = res.data.data
  return res
})

export const publicInvoicingApi = {
  invoice: (token: string) => d<PublicInvoice>(publicApi.get(`/public/invoices/${encodeURIComponent(token)}`)),
  invoicePdfUrl: (token: string) => `${publicBaseURL}/public/invoices/${encodeURIComponent(token)}/pdf`,
  mandate: (token: string) => d<PublicMandate>(publicApi.get(`/public/mandates/${encodeURIComponent(token)}`)),
  authorise: (token: string, body: AuthoriseMandateInput) =>
    d<AuthoriseMandateResult>(publicApi.post(`/public/mandates/${encodeURIComponent(token)}/authorise`, body)),
}

// ─── Invoices ──────────────────────────────────────────────────────────────
export const invoicesApi = {
  list: (params: InvoiceFilters) => d<Page<Invoice>>(api.get('/invoices', { params })),
  summary: () => d<InvoiceSummary>(api.get('/invoices/summary')),
  get: (id: string) => d<Invoice>(api.get(`/invoices/${id}`)),
  create: (body: InvoiceInput) => d<Invoice>(api.post('/invoices', body)),
  update: (id: string, body: Partial<InvoiceInput>) => d<Invoice>(api.patch(`/invoices/${id}`, body)),
  remove: (id: string, force = false) => d<{ message: string }>(api.delete(`/invoices/${id}`, { params: force ? { force: 'true' } : {} })),
  issue: (id: string) => d<Invoice>(api.post(`/invoices/${id}/issue`)),
  markSent: (id: string) => d<Invoice>(api.post(`/invoices/${id}/mark-sent`)),
  void: (id: string) => d<Invoice>(api.post(`/invoices/${id}/void`)),
  duplicate: (id: string) => d<Invoice>(api.post(`/invoices/${id}/duplicate`)),
  saveAsTemplate: (id: string, name: string) => d<InvoiceTemplate>(api.post(`/invoices/${id}/save-as-template`, { name })),
  convert: (id: string, issue = false) => d<Invoice>(api.post(`/invoices/${id}/convert`, { issue })),
  recordPayment: (id: string, body: RecordPaymentInput) => d<RecordPaymentResult>(api.post(`/invoices/${id}/payments`, body)),
  applyCredit: (id: string, creditId: string) =>
    d<RecordPaymentResult & { appliedCreditAmount: number }>(api.post(`/invoices/${id}/apply-credit`, { creditId })),
  send: (id: string, body: SendInvoiceInput) => d<SendInvoiceResult>(api.post(`/invoices/${id}/send`, body)),
  sends: (id: string) => d<InvoiceSend[]>(api.get(`/invoices/${id}/sends`)),
  shareLink: (id: string) => d<{ token: string; url: string }>(api.post(`/invoices/${id}/share-link`)),
  createRecurrence: (id: string, body: { interval: RecurrenceInterval; nextRunAt?: string; endsAt?: string; dueDays?: number }) =>
    d<InvoiceRecurrence>(api.post(`/invoices/${id}/recurrence`, body)),
  ensureCollectionAccount: (id: string) => d<Invoice>(api.post(`/invoices/${id}/collection-account`)),
  simulateCollection: (id: string, amount: number) =>
    d<{ claimed: boolean; reference: string }>(api.post(`/invoices/${id}/collection/simulate`, { amount })),
  pdf: (id: string) => api.get(`/invoices/${id}/pdf`, { responseType: 'blob' }).then((r) => r.data as Blob),
  receiptPdf: (id: string, receiptId: string) =>
    api.get(`/invoices/${id}/receipts/${receiptId}/pdf`, { responseType: 'blob' }).then((r) => r.data as Blob),
  fromTemplate: (templateId: string, body: { customerId: string; issueDate?: string }) =>
    d<Invoice>(api.post(`/invoices/from-template/${templateId}`, body)),
}

export const templatesApi = {
  list: () => d<InvoiceTemplate[]>(api.get('/invoice-templates')),
  remove: (id: string) => d<unknown>(api.delete(`/invoice-templates/${id}`)),
}

export const recurrencesApi = {
  list: () => d<InvoiceRecurrence[]>(api.get('/invoice-recurrences')),
  create: (body: RecurrenceInput) => d<InvoiceRecurrence>(api.post('/invoice-recurrences', body)),
  update: (id: string, body: Partial<RecurrenceInput>) => d<InvoiceRecurrence>(api.patch(`/invoice-recurrences/${id}`, body)),
  remove: (id: string) => d<unknown>(api.delete(`/invoice-recurrences/${id}`)),
  runDue: () => d<{ generated: number; results: RecurrenceRunResult[] }>(api.post('/invoice-recurrences/run')),
  runOne: (id: string) => d<RecurrenceRunResult>(api.post(`/invoice-recurrences/${id}/run`)),
}

// ─── Customers / credits / products ────────────────────────────────────────
export const invCustomersApi = {
  list: (params: { search?: string; status?: 'active' | 'archived' | 'all'; page?: number; limit?: number }) =>
    d<Page<InvCustomer>>(api.get('/customers', { params })),
  get: (id: string) => d<InvCustomer>(api.get(`/customers/${id}`)),
  create: (body: CustomerInput) => d<InvCustomer>(api.post('/customers', body)),
  update: (id: string, body: Partial<CustomerInput>) => d<InvCustomer>(api.patch(`/customers/${id}`, body)),
  archive: (id: string) => d<InvCustomer>(api.post(`/customers/${id}/archive`)),
  restore: (id: string) => d<InvCustomer>(api.post(`/customers/${id}/restore`)),
  merge: (keepId: string, mergeId: string) =>
    d<{ customer: InvCustomer; moved: Record<string, number> }>(api.post(`/customers/${keepId}/merge`, { mergeId })),
  remove: (id: string) => d<{ message: string }>(api.delete(`/customers/${id}`)),
  credits: (id: string) => d<CustomerCredit[]>(api.get(`/customers/${id}/credits`)),
  addCredit: (id: string, body: { amount: number; reason?: string }) => d<CustomerCredit>(api.post(`/customers/${id}/credits`, body)),
}

export const creditsApi = {
  list: (params: { status?: CreditStatus; customerId?: string; page?: number; limit?: number }) =>
    d<CreditsPage>(api.get('/customer-credits', { params })),
  refund: (id: string) => d<CustomerCredit>(api.post(`/customer-credits/${id}/refund`)),
}

export const productsApi = {
  list: (params: { search?: string; active?: boolean; page?: number; limit?: number }) =>
    d<Page<Product>>(api.get('/products', { params })),
  create: (body: ProductInput) => d<Product>(api.post('/products', body)),
  update: (id: string, body: Partial<ProductInput>) => d<Product>(api.patch(`/products/${id}`, body)),
  remove: (id: string) => d<unknown>(api.delete(`/products/${id}`)),
}

// ─── Settings ──────────────────────────────────────────────────────────────
export const invoiceSettingsApi = {
  get: () => d<InvoiceSettings>(api.get('/invoice-settings')),
  update: (body: InvoiceSettingsInput) => d<InvoiceSettings>(api.put('/invoice-settings', body)),
  setPaymentAccount: (body: { bankCode: string; accountNumber: string }) =>
    d<PaymentAccount>(api.put('/invoice-settings/payment-account', body)),
  clearPaymentAccount: () => d<{ cleared: boolean }>(api.delete('/invoice-settings/payment-account')),
  getSweep: () => d<SweepSettings>(api.get('/invoice-settings/sweep')),
  updateSweep: (body: Partial<{ enabled: boolean; bankCode: string; accountNumber: string; accountName: string; buffer: number }>) =>
    d<SweepSettings>(api.put('/invoice-settings/sweep', body)),
}

/** Static fallback (matches the API's FALLBACK_BANKS) for when /vendors/banks is unavailable or on public pages. */
export const FALLBACK_BANKS: Bank[] = [
  { name: 'Access Bank', code: '044' },
  { name: 'Ecobank Nigeria', code: '050' },
  { name: 'Fidelity Bank', code: '070' },
  { name: 'First Bank of Nigeria', code: '011' },
  { name: 'First City Monument Bank', code: '214' },
  { name: 'Guaranty Trust Bank', code: '058' },
  { name: 'Keystone Bank', code: '082' },
  { name: 'Kuda Bank', code: '50211' },
  { name: 'Moniepoint MFB', code: '50515' },
  { name: 'OPay', code: '999992' },
  { name: 'PalmPay', code: '999991' },
  { name: 'Polaris Bank', code: '076' },
  { name: 'Providus Bank', code: '101' },
  { name: 'Stanbic IBTC Bank', code: '221' },
  { name: 'Sterling Bank', code: '232' },
  { name: 'Union Bank of Nigeria', code: '032' },
  { name: 'United Bank for Africa', code: '033' },
  { name: 'Unity Bank', code: '215' },
  { name: 'Wema Bank', code: '035' },
  { name: 'Zenith Bank', code: '057' },
]

export const banksApi = {
  list: () =>
    d<Bank[]>(api.get('/vendors/banks'))
      .then((b) => (Array.isArray(b) && b.length ? [...b].sort((x, y) => x.name.localeCompare(y.name)) : FALLBACK_BANKS))
      .catch(() => FALLBACK_BANKS),
}

// ─── Client subscriptions / mandates ───────────────────────────────────────
export const subscriptionsApi = {
  list: (params: { status?: SubscriptionStatus; page?: number; limit?: number }) =>
    d<Page<ClientSubscription>>(api.get('/customer-subscriptions', { params })),
  mandates: () => d<ClientSubscription[]>(api.get('/customer-subscriptions/mandates')),
  charges: (limit = 50) => d<SubscriptionCharge[]>(api.get('/customer-subscriptions/charges', { params: { limit } })),
  create: (body: SubscriptionInput) => d<ClientSubscription>(api.post('/customer-subscriptions', body)),
  update: (id: string, body: Partial<SubscriptionInput>) => d<ClientSubscription>(api.patch(`/customer-subscriptions/${id}`, body)),
  remove: (id: string) => d<unknown>(api.delete(`/customer-subscriptions/${id}`)),
  authorisationLink: (id: string, regenerate = false) =>
    d<{ token: string; url: string; waLink: string }>(
      api.post(`/customer-subscriptions/${id}/authorisation-link`, undefined, { params: regenerate ? { regenerate: 'true' } : {} }),
    ),
  cancel: (id: string) => d<ClientSubscription>(api.post(`/customer-subscriptions/${id}/cancel`)),
  cancelMandate: (id: string) => d<ClientSubscription>(api.post(`/customer-subscriptions/${id}/cancel-mandate`)),
  charge: (id: string, body: { amount?: number; clientRequestId?: string }) =>
    d<SubscriptionCharge>(api.post(`/customer-subscriptions/${id}/charge`, body)),
}
