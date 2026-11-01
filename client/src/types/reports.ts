// Shapes mirror api/src/modules/reports/reports.service.ts and api/src/modules/sheets/sheets.service.ts.

export type ReportPeriod = 'this_month' | 'last_month' | 'ytd' | 'all' | 'custom'

export interface ReportQuery {
  period: ReportPeriod
  from?: string
  to?: string
}

export interface ResolvedPeriod {
  period: ReportPeriod
  from: string | null
  to: string | null
  label: string
}

export interface NamedTotal {
  key: string
  label: string
  items: number
  paid: number
  total: number
  share: number
  color?: string | null
}
export interface VendorTotal extends NamedTotal {
  vendorId: string
}
export interface BusinessUnitTotal extends NamedTotal {
  costCenterId: string | null
  code: string | null
}
export interface CoaRow {
  coa: string
  total: number
  byCategory: Record<string, number>
}
export interface MonthCategoryRow {
  month: string
  total: number
  byCategory: Record<string, number>
}

export interface WhtReportLine {
  batchItemId: string
  date: string
  vendorId: string
  vendor: string
  tin: string | null
  contractAmount: number
  rate: number
  wht: number
  coa: string | null
  description: string
  batchRef: string
}
export interface WhtReport {
  lines: WhtReportLine[]
  lineCount: number
  totals: { contractAmount: number; wht: number }
  vendorsMissingTin: number
  vendorsMissingTinNames: string[]
}

export interface BatchHistoryRow {
  batchId: string
  batchRef: string
  date: string
  category: string
  items: number
  total: number
  paid: number
  status: string
}

export interface MoneyOutReport {
  period: ResolvedPeriod
  currency: string
  kpis: { totalSpend: number; paid: number; outstanding: number; batches: number; items: number }
  monthlyTrend: { month: string; total: number; paid: number; items: number }[]
  categories: NamedTotal[]
  topVendors: { uniqueCount: number; rows: VendorTotal[] }
  businessUnits: BusinessUnitTotal[]
  coa: { categories: string[]; rows: CoaRow[] }
  monthlyByCategory: { categories: string[]; rows: MonthCategoryRow[]; totals: Record<string, number> }
  wht: WhtReport
  batchHistory: BatchHistoryRow[]
}

export interface SalesInvoiceRow {
  id: string
  invoiceNumber: string | null
  customer: string
  issueDate: string
  dueDate: string | null
  status: string
  currency: string
  total: number
  vat: number
  wht: number
  amountDue: number
  paid: number
  outstanding: number
}
export interface SalesReport {
  period: ResolvedPeriod
  currency: string
  kpis: { invoiced: number; collected: number; outstanding: number; vat: number; wht: number; count: number }
  byMonth: { month: string; invoiced: number; collected: number }[]
  byCustomer: { customerId: string; customer: string; invoices: number; invoiced: number; collected: number; outstanding: number }[]
  invoices: SalesInvoiceRow[]
}

export interface VendorDebtRow {
  vendorId: string
  vendor: string
  lines: number
  oldestItem: string | null
  postedUnpaid: number
  inQueue: number
  totalOwed: number
}
export interface VendorDebtReport {
  asOf: string
  currency: string
  rows: VendorDebtRow[]
  totals: { lines: number; postedUnpaid: number; inQueue: number; totalOwed: number }
}

export interface PayCategoryLite {
  id: string
  name: string
  color?: string | null
}

// ─── Sheets ──────────────────────────────────────────────────────────────────

export type SheetsTransport = 'api' | 'apps_script'

export interface SheetsConfig {
  sheetsUrl: string
  batchesTabName: string
  reconSheetUrl: string
  invoicesSheetsUrl: string
  invoicesTabName: string
  batchesTransport: SheetsTransport | null
  invoicesTransport: SheetsTransport | null
  credentialsConfigured: boolean
  serviceAccountEmail: string | null
  mockMode: boolean
}
export type SaveSheetsConfig = Partial<
  Pick<SheetsConfig, 'sheetsUrl' | 'batchesTabName' | 'reconSheetUrl' | 'invoicesSheetsUrl' | 'invoicesTabName'>
>

export interface SheetsStatus {
  configured: boolean
  reason: string | null
  transport: SheetsTransport | null
  status: 'Not synced' | 'Syncing' | 'Synced' | 'Error'
  lastSyncedAt: string | null
  lastError: string | null
  lastMessage: string | null
  unsyncedBatches: number
  mockMode: boolean
}

export interface SheetsTestResult {
  ok: boolean
  transport: SheetsTransport
  tab: string
  mock: boolean
  message: string
}

export interface SheetsSyncResult {
  ok: boolean
  status?: string
  rows?: number
  updated?: number
  appended?: number
  batches?: number
  message?: string
}

export type ReconStatus = 'Matched' | 'Fixable' | 'Mismatch' | 'No BU in app' | 'Not in app'
export interface ReconRow {
  rowNumber: number
  batchRef: string
  vendor: string
  gross: number
  sheetBu: string
  sheetBuHead: string
  appBu: string | null
  appBuHead: string | null
  batchItemId: string | null
  status: ReconStatus
  reason?: string
}
export interface ReconReport {
  tab: string
  sheetRows: number
  summary: Record<ReconStatus, number>
  appLinesNotInSheet: number
  rows: ReconRow[]
}
