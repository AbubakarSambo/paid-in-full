import { api } from '@/lib/api'
import type {
  BudgetImportCommitRow,
  BudgetImportPreview,
  BudgetOverview,
  VariancePreset,
  VarianceReport,
} from '@/types/budgets'

export const budgetKeys = {
  all: ['budgets'] as const,
  overview: (period: string, bu: string) => ['budgets', 'overview', period, bu] as const,
  variance: (preset: VariancePreset, from: string, to: string, bu: string) => ['budgets', 'variance', preset, from, to, bu] as const,
}

/** bu: 'all' (aggregate), 'none' (workspace-wide caps) or a cost-center id. */
const buParam = (bu: string) => (bu === 'all' ? undefined : bu)

export const budgetsApi = {
  overview: (period: string, bu: string) =>
    api.get<BudgetOverview>('/budgets/overview', { params: { period, costCenterId: buParam(bu) } }).then((r) => r.data),
  upsert: (body: { coaTagId: string; costCenterId?: string; period: string; amount: number }) =>
    api.put('/budgets', body).then((r) => r.data),
  remove: (id: string) => api.delete(`/budgets/${id}`).then((r) => r.data),
  copyPrevious: (body: { period: string; costCenterId?: string; overwrite?: boolean }) =>
    api.post<{ copied: number; skipped: number; from: string; to: string }>('/budgets/copy-previous', body).then((r) => r.data),
  createTag: (body: { name: string; payCategoryId?: string }) =>
    api.post<{ id: string; name: string; payCategoryId: string; created: boolean }>('/budgets/tags', body).then((r) => r.data),
  variance: (q: { preset: VariancePreset; from?: string; to?: string; bu: string }) =>
    api
      .get<VarianceReport>('/budgets/variance', {
        params: {
          preset: q.preset,
          from: q.preset === 'custom' ? q.from : undefined,
          to: q.preset === 'custom' ? q.to : undefined,
          costCenterId: buParam(q.bu),
        },
      })
      .then((r) => r.data),
  importPreview: (body: { csv: string; labelColumn?: number; amountColumn?: number; hasHeader?: boolean }) =>
    api.post<BudgetImportPreview>('/budgets/import/preview', body).then((r) => r.data),
  importCommit: (body: { period: string; costCenterId?: string; rows: BudgetImportCommitRow[] }) =>
    api
      .post<{ imported: number; rows: number; createdTags: { id: string; name: string }[] }>('/budgets/import/commit', body)
      .then((r) => r.data),
}
