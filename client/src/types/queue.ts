// Queue (spec §5.2) types — mirror api/src/modules/queue and recurring responses.

export interface QueueListItem {
  id: string
  shortId: string
  date: string
  vendorId: string
  vendorName: string
  description: string
  units: number
  unitName: string | null
  unitAmount: number
  total: number
  whtRate: number
  whtAmount: number
  netAmount: number
  payCategoryId: string | null
  coaTagId: string | null
  coaTag: string | null
  costCenter: { id: string; name: string; code: string | null } | null
  location: { id: string; name: string; isGeneral: boolean } | null
  pnlPeriod: string | null
  isUrgent: boolean
  bundleId: string | null
  bundleLabel: string | null
  recurrenceId: string | null
  requisition: { id: string; reqRef: string | null; requesterName: string | null } | null
  createdByName: string | null
  requestedByName: string | null
  noTinPhone: boolean
  noBankDetails: boolean
  commentCount: number
  attachmentCount: number
  createdAt: string
}

export interface QueueItemEntry {
  type: 'item'
  isUrgent: boolean
  item: QueueListItem
}

export interface QueueBundleEntry {
  type: 'bundle'
  isUrgent: boolean
  bundleId: string
  bundleLabel: string | null
  total: number
  itemCount: number
  vendorCount: number
  coaTags: string[]
  pnlPeriods: string[]
  createdByName: string | null
  items: QueueListItem[]
}

export type QueueEntry = QueueItemEntry | QueueBundleEntry

export interface QueueLane {
  payCategoryId: string | null
  name: string
  color: string
  itemCount: number
  total: number
  overBudget: {
    coaTag: string | null
    pct: number
    spent: number
    cap: number
    costCenter: string | null
    period: string
  } | null
  entries: QueueEntry[]
}

export interface QueueLanesResponse {
  grandTotal: number
  itemCount: number
  visibleTotal: number
  visibleCount: number
  counts: { urgent: number; noTinPhone: number; rejected: number }
  lanes: QueueLane[]
}

export interface QueueQuery {
  search?: string
  urgentOnly?: boolean
  noTinOnly?: boolean
}

export interface QueueAttachment {
  id: string
  attachmentGroupId: string
  queueItemId: string | null
  fileName: string
  mimeType: string | null
  sizeBytes: number | null
  fileUrl: string | null
  createdAt: string
}

export interface QueueComment {
  id: string
  queueItemId: string
  userId: string
  authorName: string | null
  body: string
  createdAt: string
  user?: { id: string; displayName: string | null; firstName: string; lastName: string; avatarUrl: string | null }
}

export interface QueueVendorFull {
  id: string
  name: string
  tin: string | null
  phone: string | null
  bankName: string | null
  bankCode: string | null
  bankAccountNumber: string | null
  whtExempt: boolean
  whtRate: string | number | null
  [key: string]: unknown
}

/** GET /queue/:id */
export interface QueueItemDetail {
  id: string
  date: string
  vendorId: string
  vendorName: string | null
  description: string
  units: string | number
  unitName: string | null
  unitAmount: string | number
  total: string | number
  whtRate: string | number
  whtAmount: string | number
  netAmount: string | number
  whtOverride: boolean
  whtSource: string | null
  payCategoryId: string | null
  payCategoryName: string | null
  coaTagId: string | null
  coaTag: string | null
  costCenterId: string | null
  locationId: string | null
  pnlPeriod: string | null
  isUrgent: boolean
  bundleId: string | null
  bundleLabel: string | null
  recurrenceId: string | null
  requisitionId: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  rejectedReason: string | null
  createdByName: string | null
  requestedByName: string | null
  vendor: QueueVendorFull
  payCategory: { id: string; name: string; color: string } | null
  costCenter: { id: string; name: string; code: string | null } | null
  location: { id: string; name: string; isGeneral: boolean } | null
  requisition: { id: string; reqRef: string | null; requesterName: string | null; reason: string | null; remarks: string | null } | null
  comments: QueueComment[]
  bankDetails: {
    bankName: string | null
    bankCode: string | null
    accountNumber: string | null
    accountName: string | null
    verified: boolean
  }
  wht: { rate: number; amount: number; net: number; override: boolean; source: string | null }
  approvedByName: string | null
  batchRef: string | null
  attachments: QueueAttachment[]
}

export interface QueueLinePayload {
  date?: string
  vendorId: string
  description: string
  payCategoryId: string
  coaTagId: string
  costCenterId?: string
  locationId?: string
  units?: number
  unitName?: string
  unitAmount: number
  pnlPeriod?: string
  isUrgent?: boolean
  whtRateOverride?: number | null
  invoiceNumber?: string
  invoiceDate?: string
}

export interface UpdateQueueItemPayload {
  date?: string
  vendorId?: string
  description?: string
  payCategoryId?: string
  coaTagId?: string
  costCenterId?: string | null
  locationId?: string | null
  units?: number
  unitName?: string
  unitAmount?: number
  pnlPeriod?: string
  isUrgent?: boolean
  whtRateOverride?: number | null
  bundleLabel?: string
  amountChangeReason?: string
}

export interface BundleSubItemPayload {
  vendorId: string
  description: string
  units?: number
  unitName?: string
  unitAmount: number
}

export interface CreateBundlePayload {
  date?: string
  bundleLabel: string
  payCategoryId: string
  coaTagId: string
  costCenterId?: string
  locationId?: string
  pnlPeriod?: string
  isUrgent?: boolean
  whtRateOverride?: number
  items: BundleSubItemPayload[]
  confirmDuplicate?: boolean
}

export interface DuplicateMatch {
  source: 'queue' | 'batch'
  id: string
  description: string
  total: number
  date: string
  batchRef?: string | null
}

export interface RejectedQueueItem {
  id: string
  date: string
  vendorName: string | null
  description: string
  total: number
  payCategoryName: string | null
  coaTag: string | null
  status: 'REJECTED' | 'CANCELLED'
  rejectedReason: string | null
  rejectedAt: string | null
  rejectedByName: string | null
  bundleLabel: string | null
  vendor: { id: string; name: string }
}

export interface CsvPreviewRow {
  row: number
  status: 'ok' | 'duplicate' | 'error'
  date: string | null
  vendor: string
  description: string
  category: string
  coa: string
  units: number | null
  unitAmount: number | null
  amount: number | null
  notes: string[]
  imported?: boolean
}

export interface CsvPreviewResponse {
  rows: CsvPreviewRow[]
  summary: { total: number; ok: number; duplicates: number; errors: number; importableTotal: number }
}

export interface CsvImportResponse {
  imported: number
  skipped: number
  total: number
  rows: CsvPreviewRow[]
}

export interface BudgetProjection {
  coaTagId: string
  coaTag: string
  costCenterId: string | null
  costCenter: string | null
  period: string
  cap: number
  spent: number
  thisAmount: number
  projected: number
  overBy: number
}

export interface ApproveResult {
  ok: boolean
  batchId?: string
  batchRef?: string
  total?: number
  itemCount?: number
  alreadyProcessed?: boolean
  budgetWarning?: boolean
  projections?: BudgetProjection[]
  error?: string
}

// ─── Recurring payments ───────────────────────────────────────────────────

export interface RecurringPayment {
  id: string
  vendorId: string
  description: string
  amount: string | number
  dayOfMonth: number
  urgentDays: number
  payCategoryId: string | null
  coaTagId: string | null
  costCenterId: string | null
  locationId: string | null
  isActive: boolean
  lastChargedAt: string | null
  nextRunDate: string | null
  nextDueDate: string
  nextQueueDate: string
  vendorHasBankDetails: boolean
  vendor: { id: string; name: string }
  payCategory: { id: string; name: string; color: string } | null
  coaTag: { id: string; name: string } | null
  costCenter: { id: string; name: string; code: string | null } | null
  location: { id: string; name: string } | null
}

export interface RecurringPayload {
  vendorId: string
  description: string
  amount: number
  dayOfMonth: number
  urgentDays?: number
  payCategoryId: string
  coaTagId: string
  costCenterId?: string | null
  locationId?: string | null
  isActive?: boolean
}

export interface RecurringRunResult {
  queued: number
  skippedNoBank: number
  errors?: { recurringPaymentId: string; description: string; error: string }[]
}

// ─── Lookups used by queue / requisitions / budgets screens ───────────────

export interface LookupCoaTag {
  id: string
  name: string
  payCategoryId: string
  isActive: boolean
}

export interface LookupCategory {
  id: string
  name: string
  color: string
  isActive: boolean
  includeInBudgets: boolean
  sortOrder: number
  coaTags: LookupCoaTag[]
}

export interface LookupLocation {
  id: string
  name: string
  costCenterId: string | null
  isGeneral: boolean
  isActive: boolean
}

export interface LookupCostCenter {
  id: string
  name: string
  code: string | null
  isActive: boolean
  locations: LookupLocation[]
}

export interface LookupVendor {
  id: string
  name: string
  bankName: string | null
  bankCode: string | null
  bankAccountNumber: string | null
  tin: string | null
  phone: string | null
  isActive?: boolean
}

export interface LookupStock {
  id: string
  name: string
  description: string | null
  payCategoryId: string | null
  coaTagId: string | null
  vendorId: string | null
  unitName: string | null
  unitAmount: string | number
}
