// Budgets (spec §5.7) — mirrors api/src/modules/budgets.

export interface BudgetOverviewRow {
  coaTagId: string
  name: string
  payCategory: { id: string; name: string; color: string }
  cap: number | null
  budgetId: string | null
  spent: number
  remaining: number | null
  pct: number | null
  over: number
}

export interface BudgetOverview {
  period: string
  costCenterId: string
  kpis: { totalCap: number; spent: number; remaining: number }
  rows: BudgetOverviewRow[]
  businessUnits: { id: string; name: string; code: string | null }[]
}

export type VariancePreset = 'mtd' | 'this_month' | 'last_month' | 'last_30' | 'last_90' | 'ytd' | 'custom'

export interface VarianceLine {
  source: 'queue' | 'batch'
  id: string
  date: string
  vendorName: string | null
  description: string
  total: number
  pnlPeriod: string | null
  batchRef?: string
  status: string
}

export interface VarianceRow {
  coaTagId: string
  coaTag: string
  payCategory: { id: string; name: string; color: string }
  budget: number
  actual: number
  variance: number
  variancePct: number | null
  lines: VarianceLine[]
}

export interface VarianceReport {
  summary: {
    budget: number
    actual: number
    variance: number
    variancePct: number | null
    from: string
    to: string
    days: number
    preset: VariancePreset
    costCenterId: string
  }
  rows: VarianceRow[]
}

export interface BudgetImportColumn {
  index: number
  header: string
  numericRatio: number
  textRatio: number
  sample: string[]
}

export interface BudgetImportPreviewRow {
  row: number
  label: string
  amount: number | null
  valid: boolean
  suggestedCoaTagId: string | null
  suggestedCoaTagName: string | null
  match: 'exact' | 'fuzzy' | 'none'
}

export interface BudgetImportPreview {
  headers: string[]
  hasHeader: boolean
  columns: BudgetImportColumn[]
  labelColumn: number | null
  amountColumn: number | null
  rows: BudgetImportPreviewRow[]
  tags?: { id: string; name: string; payCategory: string }[]
}

export interface BudgetImportCommitRow {
  label: string
  amount: number
  coaTagId?: string
  newTagName?: string
  payCategoryId?: string
}
