import { api } from '@/lib/api'
import type {
  MoneyOutReport,
  PayCategoryLite,
  ReportQuery,
  SalesReport,
  VendorDebtReport,
  WhtReport,
} from '@/types/reports'

/** Only send from/to for a custom period (the API ignores them otherwise, but keeps URLs clean). */
const periodParams = (q: ReportQuery) =>
  q.period === 'custom' ? { period: q.period, from: q.from || undefined, to: q.to || undefined } : { period: q.period }

const blob = (url: string, params: Record<string, unknown>) =>
  api.get<Blob>(url, { params, responseType: 'blob' }).then((r) => r.data)

export const reportsApi = {
  moneyOut: (q: ReportQuery) => api.get<MoneyOutReport>('/reports/money-out', { params: periodParams(q) }).then((r) => r.data),
  wht: (q: ReportQuery) => api.get<WhtReport>('/reports/wht', { params: periodParams(q) }).then((r) => r.data),
  sales: (q: ReportQuery) => api.get<SalesReport>('/reports/sales', { params: periodParams(q) }).then((r) => r.data),
  vendorDebt: (asOf?: string) =>
    api.get<VendorDebtReport>('/reports/vendor-debt', { params: { asOf: asOf || undefined } }).then((r) => r.data),

  moneyOutCsv: (q: ReportQuery) => blob('/reports/money-out/export.csv', periodParams(q)),
  moneyOutPdf: (q: ReportQuery) => blob('/reports/money-out/export.pdf', periodParams(q)),
  whtCsv: (q: ReportQuery) => blob('/reports/wht/export.csv', periodParams(q)),
  salesCsv: (q: ReportQuery) => blob('/reports/sales/export.csv', periodParams(q)),
  vendorDebtCsv: (asOf?: string) => blob('/reports/vendor-debt/export.csv', { asOf: asOf || undefined }),
  vendorDebtPdf: (asOf?: string) => blob('/reports/vendor-debt/export.pdf', { asOf: asOf || undefined }),

  /** Pay categories carry the user-chosen colour used across the category charts. */
  payCategories: () => api.get<PayCategoryLite[]>('/pay-categories').then((r) => r.data),
}
