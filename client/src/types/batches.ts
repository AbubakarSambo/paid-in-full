// Batches / disbursement / statement-recon types. Mirrors api/src/modules/{batches,settlement}.
// Prisma Decimal columns arrive as strings; computed figures (paid, outstanding…) are numbers.

export type Money = string | number

export type BatchPayoutStatus = 'PENDING' | 'PROCESSING' | 'PARTIAL' | 'SUCCESS' | 'CANCELLED'
export type BatchItemPayoutStatus = 'PENDING' | 'SENDING' | 'SUCCESS' | 'FAILED' | 'REVERSED' | 'CANCELLED' | 'SKIPPED'
export type PayoutLegStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REVERSED'
export type BatchFilter = 'all' | 'ready' | 'paid'

export interface BatchBase {
  id: string
  workspaceId: string
  batchRef: string
  payCategoryId: string | null
  payCategoryName: string | null
  payCategoryColor: string | null
  date: string
  total: Money
  payoutStatus: BatchPayoutStatus
  isManual: boolean
  approvedByName: string | null
  approvedAt: string | null
  disbursedAt: string | null
  cancelledAt: string | null
  cancelledReason: string | null
  syncedToSheets: boolean
  createdAt: string
  updatedAt: string
}

/** Row of GET /batches. */
export interface BatchSummary extends BatchBase {
  itemCount: number
  activeItemCount: number
  paid: number
  outstanding: number
  readyCount: number
  inFlightCount: number
  failedCount: number
  vendors: string[]
  isReady: boolean
}

export interface BatchKpis {
  readyToPay: { batches: number; lines: number; amount: number }
  inFlight: { transfers: number; amount: number }
  paidThisWeek: { lines: number; amount: number }
  failedLines: { lines: number; amount: number }
}

export interface BatchListResponse {
  kpis: BatchKpis
  counts: { all: number; ready: number; paid: number }
  batches: BatchSummary[]
  paidBatches: BatchSummary[]
}

export interface PayoutLeg {
  id: string
  batchItemId: string
  leg: 'VENDOR' | 'WHT'
  amount: Money
  status: PayoutLegStatus
  reference: string
  transferReference: string | null
  failureReason: string | null
  destinationAccountNumber: string | null
  destinationBankCode: string | null
  destinationAccountName: string | null
  completedAt: string | null
  statusCheckedAt: string | null
  createdAt: string
}

export interface BatchLine {
  id: string
  batchId: string
  queueItemId: string | null
  date: string
  vendorId: string
  vendorName: string
  vendorBank: string | null
  vendorBankCode: string | null
  vendorAcctNo: string | null
  vendorAcctName: string | null
  description: string
  bundleId: string | null
  bundleLabel: string | null
  units: Money
  unitName: string | null
  unitAmount: Money
  total: Money
  whtRate: Money
  whtAmount: Money
  netAmount: Money
  paidAmount: Money
  payoutStatus: BatchItemPayoutStatus
  payoutReference: string | null
  payoutMessage: string | null
  payCategoryId: string | null
  payCategoryName: string | null
  coaTagId: string | null
  coaTag: string | null
  costCenterId: string | null
  locationId: string | null
  pnlPeriod: string | null
  isManual: boolean
  returnedAt: string | null
  payouts: PayoutLeg[]
  costCenter: { id: string; name: string; code: string | null } | null
  location: { id: string; name: string } | null
  // computed
  paid: number
  outstanding: number
  isPaid: boolean
  selectable: boolean
  unsafeReason: string | null
  hasPayoutAttempt: boolean
  whtPaid: number
  bundleKey: string | null
}

export interface BundleTotal {
  bundleKey: string
  label: string
  itemCount: number
  total: number
  paid: number
}

export interface BatchDetail extends BatchBase {
  items: BatchLine[]
  bundleTotals: BundleTotal[]
  totals: { total: number; paid: number; outstanding: number; failedLines: number; inFlightLines: number }
  untouched: boolean
}

// ─── Disbursement ───

export interface DisburseLineInput {
  itemId: string
  amount?: number
}

export interface DisbursePreviewInput {
  lines: DisburseLineInput[]
  aggregateByVendor?: boolean
}

export interface DisburseInput extends DisbursePreviewInput {
  clientRequestId: string
  typedTotal: number
  pin: string
  password?: string
}

export interface DisbursePreviewLine {
  itemId: string
  vendorName: string
  outstanding: number
  amount: number
  vendorLeg: number
  whtLeg: number
  status: 'OK' | 'SKIPPED' | 'BLOCKED'
  message?: string
}

export interface DisbursePreview {
  batchId: string
  batchRef: string
  lines: DisbursePreviewLine[]
  total: number
  whtTotal: number
  transfers: number
  whtAccountConfigured: boolean
  readyToSend: number
  clearing: number
  shortBy: number
  shortMessage: string | null
  errors: string[]
  canSubmit: boolean
}

export type LineResultLabel = 'PAID' | 'FAILED' | 'SKIPPED' | 'AWAITING_CONFIRMATION'

export interface DisburseResultLine {
  itemId: string
  vendorName: string
  description?: string
  amount: number
  result: LineResultLabel
  label: string
  message?: string | null
  references: string[]
}

export interface DisburseResult {
  batchId: string
  batchRef: string
  clientRequestId: string
  total: number
  batchStatus?: BatchPayoutStatus
  complete: boolean
  summary: {
    paid: number
    paidAmount: number
    failed: number
    failedAmount: number
    skipped: number
    awaiting: number
    awaitingAmount: number
  }
  lines: DisburseResultLine[]
  recovered?: boolean
}

/** GET /batches/:id/disbursements/:clientRequestId */
export type DisburseRecovery =
  | ({ found: true } & DisburseResult)
  | { found: false; batchId: string; clientRequestId: string; message: string }

export interface CheckStatusResult {
  checked: number
  success: number
  failed: number
  reversed: number
  pending: number
  errors: number
  batch: BatchDetail
}

export interface RetryResult {
  reset: number
  itemIds: string[]
  blocked: Array<{ itemId: string; reason?: string }>
}

// ─── Line actions ───

export interface ReclassifyInput {
  costCenterId?: string
  locationId?: string | null
  coaTagId?: string
  pnlPeriod?: string
  vendorId?: string
  description?: string
}

export interface SplitInput {
  payNowAmount: number
  remainderDescription?: string
}

export interface ManualExpenseInput {
  date: string
  payCategoryId: string
  vendorId: string
  description: string
  coaTagId: string
  pnlPeriod?: string
  costCenterId: string
  locationId: string
  units?: number
  unitName?: string
  unitAmount: number
}

export interface ManualExpenseResult {
  batchId: string
  batchRef: string
  itemId: string
  total: number
  message: string
}

export interface WhatsappLink {
  url: string
  phone: string | null
  text: string
}

// ─── Statement reconciliation ───

export interface StatementCandidate {
  batchItemId: string
  batchId: string
  batchRef: string
  vendorName: string
  description: string
  outstanding: number
  suggestedAmount: number
  confidence: number
  reasons: string[]
}

export interface StatementRow {
  row: number
  date: string | null
  description: string
  reference: string
  debit: number
  candidates: StatementCandidate[]
  match: StatementCandidate | null
}

export interface StatementPreview {
  columns: { date: string; description: string | null; debit: string; reference: string | null }
  debitRows: number
  matched: number
  rows: StatementRow[]
}

export interface StatementMatchInput {
  batchItemId: string
  amount: number
  debit?: number
  statementDate?: string
  statementReference?: string
  description?: string
  row?: number
}

export interface StatementConfirmResult {
  recorded: number
  alreadyRecorded: number
  rejected: number
  results: Array<{ batchItemId: string; reference?: string; status: 'RECORDED' | 'ALREADY_RECORDED' | 'REJECTED'; message?: string }>
}
