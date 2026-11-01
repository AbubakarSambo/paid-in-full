import { api } from '@/lib/api'
import type {
  CoaByCategory,
  CoaDefaultsPreview,
  CoaSuggestResult,
  CoaTag,
  CostCenter,
  Location,
  PayCategory,
  UsageResult,
  WhtAccount,
  WhtRate,
  WhtResolution,
} from '@/types/spend'

/** Human-readable message from an API error ({message} may be a string or a validation array). */
export function apiError(e: unknown, fallback = 'Something went wrong'): string {
  const err = e as { response?: { data?: { message?: unknown } }; message?: string }
  const m = err?.response?.data?.message
  if (Array.isArray(m)) return m.join(', ')
  if (typeof m === 'string' && m) return m
  return err?.message || fallback
}

/** HTTP status from an axios error (or undefined). */
export function apiStatus(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status
}

/** GET a CSV/PDF endpoint as a blob and save it. */
export async function downloadFile(path: string, filename: string, params?: Record<string, unknown>) {
  const r = await api.get(path, { params, responseType: 'blob' })
  const url = window.URL.createObjectURL(r.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

export const payCategoriesApi = {
  list: (opts: { includeTags?: boolean; activeOnly?: boolean } = {}) =>
    api.get<PayCategory[]>('/pay-categories', { params: opts }).then((r) => r.data),
  usage: (id: string) => api.get<UsageResult>(`/pay-categories/${id}/usage`).then((r) => r.data),
  create: (body: { name: string; color?: string; includeInBudgets?: boolean; code?: string }) =>
    api.post<PayCategory>('/pay-categories', body).then((r) => r.data),
  update: (id: string, body: Partial<{ name: string; color: string; includeInBudgets: boolean; isActive: boolean; code: string }>) =>
    api.patch<PayCategory>(`/pay-categories/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/pay-categories/${id}`).then((r) => r.data),
  reorder: (ids: string[]) => api.put<PayCategory[]>('/pay-categories/reorder', { ids }).then((r) => r.data),
}

export const coaTagsApi = {
  list: (opts: { payCategoryId?: string; includeInactive?: boolean } = {}) =>
    api.get<CoaTag[]>('/coa-tags', { params: opts }).then((r) => r.data),
  byCategory: () => api.get<CoaByCategory>('/coa-tags/by-category').then((r) => r.data),
  create: (payCategoryId: string, name: string) => api.post<CoaTag>('/coa-tags', { payCategoryId, name }).then((r) => r.data),
  update: (id: string, body: Partial<{ name: string; isActive: boolean; sortOrder: number }>) =>
    api.patch<CoaTag>(`/coa-tags/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/coa-tags/${id}`).then((r) => r.data),
  importCsv: (payCategoryId: string, csv: string) =>
    api
      .post<{ created: string[]; reactivated: string[]; skipped: string[] }>('/coa-tags/import', { payCategoryId, csv })
      .then((r) => r.data),
  downloadTemplate: (payCategoryId: string, name: string) =>
    downloadFile('/coa-tags/template.csv', `coa-tags-${name.toLowerCase().replace(/\W+/g, '-')}.csv`, { payCategoryId }),
  previewDefaults: (industry?: string) =>
    api.get<CoaDefaultsPreview>('/coa-tags/default-setup', { params: industry ? { industry } : {} }).then((r) => r.data),
  applyDefaults: (body: { industry?: string; confirmReplace?: boolean }) =>
    api.post<{ industry: string; categories: unknown }>('/coa-tags/default-setup', body).then((r) => r.data),
  suggest: (payCategoryId: string, industry?: string, limit = 8) =>
    api.post<CoaSuggestResult>('/coa-tags/ai-suggest', { payCategoryId, industry: industry || undefined, limit }).then((r) => r.data),
}

export const costCentersApi = {
  list: (opts: { includeHeads?: boolean; activeOnly?: boolean } = {}) =>
    api.get<CostCenter[]>('/cost-centers', { params: opts }).then((r) => r.data),
  create: (body: { name: string; code?: string; createGeneralHead?: boolean }) =>
    api.post<CostCenter>('/cost-centers', body).then((r) => r.data),
  update: (id: string, body: Partial<{ name: string; code: string; isActive: boolean }>) =>
    api.patch<CostCenter>(`/cost-centers/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/cost-centers/${id}`).then((r) => r.data),
  reorder: (ids: string[]) => api.put('/cost-centers/reorder', { ids }).then((r) => r.data),
}

export const locationsApi = {
  list: (opts: { costCenterId?: string; activeOnly?: boolean } = {}) =>
    api.get<Location[]>('/locations', { params: opts }).then((r) => r.data),
  create: (body: { name: string; costCenterId: string; isGeneral?: boolean }) =>
    api.post<Location>('/locations', body).then((r) => r.data),
  update: (id: string, body: Partial<{ name: string; isGeneral: boolean; isActive: boolean }>) =>
    api.patch<Location>(`/locations/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/locations/${id}`).then((r) => r.data),
  reorder: (ids: string[]) => api.put('/locations/reorder', { ids }).then((r) => r.data),
}

export const whtApi = {
  rates: () => api.get<WhtRate[]>('/wht/rates').then((r) => r.data),
  defaults: () => api.get<{ coa: string; rate: number; label: string }[]>('/wht/rates/defaults').then((r) => r.data),
  seedDefaults: (overwrite = false) =>
    api.post<{ created: number; updated: number; rates: WhtRate[] }>('/wht/rates/seed-defaults', { overwrite }).then((r) => r.data),
  upsertRate: (body: { coa: string; rate: number; label?: string }) => api.put<WhtRate>('/wht/rates', body).then((r) => r.data),
  updateRate: (id: string, body: Partial<{ coa: string; rate: number; label: string }>) =>
    api.patch<WhtRate>(`/wht/rates/${id}`, body).then((r) => r.data),
  removeRate: (id: string) => api.delete(`/wht/rates/${id}`).then((r) => r.data),
  resolve: (body: { vendorId?: string; coa?: string; total?: number }) =>
    api.post<WhtResolution>('/wht/resolve', body).then((r) => r.data),
  account: () => api.get<WhtAccount>('/wht/account').then((r) => r.data),
  updateAccount: (body: { bankCode: string; accountNumber: string; accountName?: string; allowUnverified?: boolean }) =>
    api.put<WhtAccount>('/wht/account', body).then((r) => r.data),
  clearAccount: () => api.delete('/wht/account').then((r) => r.data),
}
