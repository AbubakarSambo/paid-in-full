// Invoicing (Biller module) types. Mirrors api/src/modules/{invoices,customers,products,billing}.
// Prisma Decimals arrive as strings, so money fields are typed `number | string`; wrap them in Number().

export type Num = number | string

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'VOID'
export type DocType = 'INVOICE' | 'QUOTE'
export type DiscountType = 'PERCENT' | 'FLAT'
export type RecurrenceInterval = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY'
export type CreditStatus = 'OPEN' | 'APPLIED' | 'REFUNDED'
export type SubscriptionStatus = 'PENDING_MANDATE' | 'ACTIVE' | 'CANCELLED'
export type MandateType = 'CARD' | 'DIRECT_DEBIT'
export type ChargeStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | string

export interface PageMeta {
  total: number
  page: number
  limit: number
  totalPages: number
}
export interface Page<T> {
  data: T[]
  meta: PageMeta
}

// ─── Customers ─────────────────────────────────────────────────────────────
export interface InvCustomer {
  id: string
  workspaceId: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
  taxId: string | null
  notes: string | null
  isArchived: boolean
  mergedIntoId: string | null
  createdAt: string
  updatedAt: string
  invoiceCount?: number
  subscriptionCount?: number
  outstanding?: number
  openCredit?: number
}

export interface CustomerInput {
  name: string
  email?: string
  phone?: string
  address?: string
  taxId?: string
  notes?: string
}

export interface CustomerCredit {
  id: string
  customerId: string
  amount: Num
  note: string | null
  status: CreditStatus
  appliedToInvoiceId: string | null
  appliedAt: string | null
  sourceInvoiceId: string | null
  createdAt: string
  customer?: { id: string; name: string }
  sourceInvoice?: { id: string; invoiceNumber: string | null } | null
  appliedToInvoice?: { id: string; invoiceNumber: string | null } | null
}

export interface CreditsPage extends Page<CustomerCredit> {
  openTotal: number
}

// ─── Products ──────────────────────────────────────────────────────────────
export interface Product {
  id: string
  name: string
  description: string | null
  sku: string | null
  unitName: string | null
  unitPrice: Num
  taxRate: Num
  isActive: boolean
  active: boolean
}
export interface ProductInput {
  name: string
  description?: string
  sku?: string
  unitName?: string
  unitPrice: number
  taxRate?: number
  active?: boolean
}

// ─── Invoices ──────────────────────────────────────────────────────────────
export interface InvoiceItem {
  id: string
  productId: string | null
  description: string
  quantity: Num
  unitPrice: Num
  vatRate: Num
  whtRate: Num
  lineTotal: Num
  sortOrder: number
}

export interface InvoicePayment {
  id: string
  amount: Num
  monnifyReference: string | null
  method: string | null
  notes: string | null
  paidAt: string
  settledAt: string | null
}

export interface InvoiceSend {
  id: string
  channel: string
  sentTo: string
  cc: string | null
  sentAt: string
}

export interface InvoiceSweep {
  id: string
  amount: Num
  reference: string | null
  status: string | null
  matchedAt: string
}

export interface PaymentReceipt {
  id: string
  invoicePaymentId: string | null
  receiptNumber: string
  createdAt: string
}

export interface Invoice {
  id: string
  docType: DocType
  number: string | null
  invoiceNumber: string | null
  quoteNumber: string | null
  quoteExpiresAt: string | null
  isQuoteExpired: boolean
  customerId: string
  customer?: Partial<InvCustomer> & { id: string; name: string }
  customerAddress: string | null
  customerTin: string | null
  workspaceTin: string | null
  status: InvoiceStatus
  issueDate: string
  dueDate: string | null
  dueDays: number | null
  currency: string
  fxRate: Num | null
  fxBaseCurrency: string | null
  taxInclusive: boolean
  discountType: DiscountType | null
  discountValue: Num
  discountAmount: Num
  subtotal: Num
  vatTotal: Num
  whtTotal: Num
  total: Num
  amountDue: Num
  paidAmount: Num
  balance: number
  lateFeePercent: Num | null
  lateFeeFlat: Num | null
  lateFeeGraceDays: number | null
  lateFeeAmount: Num
  earlyPayDiscountPercent: Num | null
  earlyPayDiscountDays: number | null
  earlyPayDiscountAmount: Num
  notes: string | null
  terms: string | null
  templateId: string | null
  recurrenceId: string | null
  collectionAccountNumber: string | null
  collectionAccountName: string | null
  collectionBankName: string | null
  shareToken: string | null
  shareUrl: string | null
  sentAt: string | null
  voidedAt: string | null
  createdAt: string
  // detail-only
  items?: InvoiceItem[]
  payments?: InvoicePayment[]
  sends?: InvoiceSend[]
  sweeps?: InvoiceSweep[]
  receipts?: PaymentReceipt[]
  creditsApplied?: CustomerCredit[]
  creditsCreated?: CustomerCredit[]
  sourceOfRecurrence?: InvoiceRecurrence | null
}

export interface InvoiceItemInput {
  productId?: string
  description?: string
  quantity: number
  unitPrice?: number
  vatRate?: number
  whtRate?: number
}

export interface InvoiceInput {
  docType?: DocType
  issue?: boolean
  customerId: string
  customerAddress?: string
  issueDate?: string
  dueDate?: string
  dueDays?: number
  quoteExpiresAt?: string
  currency?: string
  fxRate?: number
  fxBaseCurrency?: string
  taxInclusive?: boolean
  items: InvoiceItemInput[]
  discountType?: DiscountType | null
  discountValue?: number
  workspaceTin?: string
  customerTin?: string
  lateFeePercent?: number
  lateFeeFlat?: number
  lateFeeGraceDays?: number
  earlyPayDiscountPercent?: number
  earlyPayDiscountDays?: number
  notes?: string
  terms?: string
  templateId?: string
}

export interface InvoiceSummary {
  paidThisMonth: number
  outstanding: number
  outstandingCount: number
  overdue: number
  overdueCount: number
}

export interface InvoiceFilters {
  status?: InvoiceStatus
  docType?: DocType
  customerId?: string
  search?: string
  page?: number
  limit?: number
}

export interface RecordPaymentInput {
  amount: number
  paymentDate?: string
  reference?: string
  method?: 'TRANSFER' | 'CASH' | 'CARD' | 'CHEQUE' | 'POS' | 'OTHER'
  notes?: string
  clientRequestId?: string
}

export interface RecordPaymentResult {
  payment: InvoicePayment | null
  receipt: PaymentReceipt | null
  credit: CustomerCredit | null
  applied: number
  excess: number
}

export interface SendInvoiceInput {
  channel?: 'EMAIL' | 'WHATSAPP'
  recipient?: string
  cc?: string[]
  message?: string
}
export interface SendInvoiceResult {
  channel: 'EMAIL' | 'WHATSAPP'
  shareUrl: string
  waLink?: string
  send: InvoiceSend
  ccFailures?: string[]
}

// ─── Templates & recurrences ───────────────────────────────────────────────
export interface InvoiceTemplate {
  id: string
  name: string
  notes: string | null
  terms: string | null
  currency: string | null
  settings: Record<string, unknown> | null
  createdAt: string
  items: InvoiceItem[]
}

export interface InvoiceRecurrence {
  id: string
  customerId: string | null
  invoiceId: string | null
  interval: RecurrenceInterval
  nextRunAt: string
  endsAt: string | null
  dueDays: number
  currency: string
  notes: string | null
  terms: string | null
  templateItems: InvoiceItemInput[] | null
  lastRunAt: string | null
  isActive: boolean
  createdAt: string
  customer?: { id: string; name: string; email: string | null } | null
  invoices?: { id: string; invoiceNumber: string | null; status: InvoiceStatus; issueDate: string }[]
}

export interface RecurrenceInput {
  customerId: string
  interval: RecurrenceInterval
  nextRunAt: string
  endsAt?: string
  dueDays?: number
  currency?: string
  notes?: string
  terms?: string
  items: InvoiceItemInput[]
  isActive?: boolean
}

export interface RecurrenceRunResult {
  recurrenceId: string
  invoiceId: string | null
  invoiceNumber?: string | null
  skipped?: string
  error?: string
}

// ─── Settings ──────────────────────────────────────────────────────────────
export interface PaymentAccount {
  bankCode: string
  bankName?: string | null
  accountNumber: string
  accountName: string
  verifiedAt?: string
}

export interface InvoiceSettings {
  branding: { logoUrl: string | null; signatureUrl: string | null; themeColor: string; footerText: string | null }
  invoicePrefix: string
  quotePrefix: string
  vatOnNewInvoices: boolean
  defaultVatRate: number
  defaultTerms: string
  workspaceTin: string | null
  paymentAccount: PaymentAccount | null
}

export interface InvoiceSettingsInput {
  logoUrl?: string | null
  signatureUrl?: string | null
  themeColor?: string
  footerText?: string | null
  invoicePrefix?: string
  quotePrefix?: string
  vatOnNewInvoices?: boolean
  defaultTerms?: string
}

export interface SweepSettings {
  enabled: boolean
  bankCode: string | null
  bankName: string | null
  accountNumber: string | null
  accountName: string | null
  buffer: number
}

export interface Bank {
  name: string
  code: string
}

// ─── Client subscriptions / mandates ───────────────────────────────────────
export interface SubscriptionCharge {
  id: string
  subscriptionId: string
  amount: Num
  status: ChargeStatus
  reference: string
  failureReason: string | null
  attemptedAt: string
  settledAt: string | null
  subscription?: { id: string; planName: string | null; mandateType: MandateType | null; customer: { id: string; name: string } }
}

export interface ClientSubscription {
  id: string
  customerId: string
  planName: string | null
  description: string | null
  interval: RecurrenceInterval
  amount: Num
  status: SubscriptionStatus
  mandateType: MandateType | null
  mandateId: string | null
  cardLast4: string | null
  nextRunAt: string
  lastChargedAt: string | null
  authorisedAt: string | null
  cancelledAt: string | null
  hasCardToken: boolean
  authorisationUrl: string | null
  createdAt: string
  customer?: { id: string; name: string; email: string | null; phone?: string | null }
  charges?: SubscriptionCharge[]
}

export interface SubscriptionInput {
  customerId: string
  planName: string
  amount: number
  interval: RecurrenceInterval
  description?: string
  startDate?: string
}

// ─── Public ────────────────────────────────────────────────────────────────
export interface PublicInvoice {
  docType: DocType
  number: string | null
  quoteNumber: string | null
  status: InvoiceStatus
  issueDate: string
  dueDate: string | null
  quoteExpiresAt: string | null
  isQuoteExpired: boolean
  currency: string
  taxInclusive: boolean
  from: { name: string; tin: string | null }
  billTo: { name: string; email: string | null; phone: string | null; address: string | null; tin: string | null }
  items: { description: string; quantity: number; unitPrice: number; vatRate: number; whtRate: number; lineTotal: number }[]
  totals: {
    subtotal: number
    discountType: DiscountType | null
    discountValue: number
    discount: number
    vat: number
    total: number
    lessWht: number
    lateFee: number
    earlyPayDiscount: number
    amountDue: number
    paid: number
    balance: number
  }
  lateFee: { percent: number | null; flat: number | null; graceDays: number | null }
  earlyPay: { percent: number | null; days: number | null }
  bankDetails: { type: string; bankName: string | null; accountNumber: string; accountName: string | null } | null
  notes: string | null
  terms: string | null
  branding: { logoUrl: string | null; signatureUrl: string | null; themeColor: string; footerText: string | null }
  signatureUrl: string | null
  poweredBy: string
}

export interface PublicMandate {
  status: SubscriptionStatus
  planName: string | null
  description: string | null
  amount: number
  frequency: RecurrenceInterval
  firstChargeDate: string
  currency: string
  customer: { name: string; email: string | null; phone: string | null; address: string | null }
  merchant: { name: string; logoUrl: string | null }
  mandateType: MandateType | null
  cardLast4: string | null
  cardVerificationAmount: number
  securedBy: string
}

export interface AuthoriseMandateInput {
  method: MandateType
  redirectUrl?: string
  email?: string
  bankCode?: string
  accountNumber?: string
  phone?: string
  address?: string
  accountName?: string
}

export interface AuthoriseMandateResult {
  method: MandateType
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'PENDING_BANK_APPROVAL'
  checkoutUrl?: string
  reference?: string
  authorizationLink?: string | null
}
