import { api } from '@/lib/api'
import type {
  ApproveResult,
  BudgetProjection,
  CreateBundlePayload,
  BundleSubItemPayload,
  CsvImportResponse,
  CsvPreviewResponse,
  QueueAttachment,
  QueueComment,
  QueueItemDetail,
  QueueLanesResponse,
  QueueLinePayload,
  QueueQuery,
  RejectedQueueItem,
  UpdateQueueItemPayload,
} from '@/types/queue'

export const queueKeys = {
  all: ['queue'] as const,
  lanes: (q: QueueQuery) => ['queue', 'lanes', q] as const,
  rejected: (search?: string) => ['queue', 'rejected', search ?? ''] as const,
  item: (id: string) => ['queue', 'item', id] as const,
  comments: (id: string) => ['queue', 'comments', id] as const,
}

export const queueApi = {
  lanes: (q: QueueQuery) =>
    api
      .get<QueueLanesResponse>('/queue', {
        params: {
          search: q.search || undefined,
          urgentOnly: q.urgentOnly || undefined,
          noTinOnly: q.noTinOnly || undefined,
        },
      })
      .then((r) => r.data),
  rejected: (search?: string) =>
    api.get<RejectedQueueItem[]>('/queue/rejected', { params: { search: search || undefined } }).then((r) => r.data),
  get: (id: string) => api.get<QueueItemDetail>(`/queue/${id}`).then((r) => r.data),
  create: (payload: QueueLinePayload & { confirmDuplicate?: boolean }) => api.post('/queue', payload).then((r) => r.data),
  bulk: (rows: QueueLinePayload[], confirmDuplicates?: boolean) =>
    api
      .post<{ created: number; total: number }>('/queue/bulk', { rows, confirmDuplicates })
      .then((r) => r.data),
  update: (id: string, payload: UpdateQueueItemPayload) => api.patch(`/queue/${id}`, payload).then((r) => r.data),
  remove: (id: string) => api.delete(`/queue/${id}`).then((r) => r.data),
  split: (id: string, body: { parts?: number; lines?: { amount: number; description?: string }[] }) =>
    api.post(`/queue/${id}/split`, body).then((r) => r.data),
  reject: (id: string, reason: string) => api.post(`/queue/${id}/reject`, { reason }).then((r) => r.data),
  restore: (id: string) => api.post(`/queue/${id}/restore`).then((r) => r.data),

  csvTemplate: () => api.get<Blob>('/queue/csv/template', { responseType: 'blob' }).then((r) => r.data),
  csvPreview: (csv: string) => api.post<CsvPreviewResponse>('/queue/csv/preview', { csv }).then((r) => r.data),
  csvImport: (csv: string, confirmDuplicates?: boolean) =>
    api.post<CsvImportResponse>('/queue/csv/import', { csv, confirmDuplicates }).then((r) => r.data),

  createBundle: (payload: CreateBundlePayload) => api.post('/queue/bundles', payload).then((r) => r.data),
  addBundleItems: (bundleId: string, items: BundleSubItemPayload[], confirmDuplicate?: boolean) =>
    api.post(`/queue/bundles/${bundleId}/items`, { items, confirmDuplicate }).then((r) => r.data),
  renameBundle: (bundleId: string, bundleLabel: string) =>
    api.patch(`/queue/bundles/${bundleId}`, { bundleLabel }).then((r) => r.data),
  bundleUrgent: (bundleId: string, isUrgent: boolean) =>
    api.patch(`/queue/bundles/${bundleId}/urgent`, { isUrgent }).then((r) => r.data),
  deleteBundle: (bundleId: string) => api.delete(`/queue/bundles/${bundleId}`).then((r) => r.data),

  attachments: (id: string) => api.get<QueueAttachment[]>(`/queue/${id}/attachments`).then((r) => r.data),
  uploadAttachment: (id: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<QueueAttachment>(`/queue/${id}/attachments`, fd).then((r) => r.data)
  },
  downloadAttachment: (attachmentId: string) =>
    api.get<Blob>(`/queue/attachments/${attachmentId}/download`, { responseType: 'blob' }).then((r) => r.data),
  removeAttachment: (attachmentId: string) => api.delete(`/queue/attachments/${attachmentId}`).then((r) => r.data),

  comments: (id: string) => api.get<QueueComment[]>(`/queue/${id}/comments`).then((r) => r.data),
  addComment: (id: string, body: string) => api.post<QueueComment>(`/queue/${id}/comments`, { body }).then((r) => r.data),

  budgetCheck: (queueItemIds: string[], payCategoryId?: string) =>
    api
      .post<{ anyOver: boolean; projections: BudgetProjection[] }>('/queue/approve/budget-check', { queueItemIds, payCategoryId })
      .then((r) => r.data),
  budgetCancel: (queueItemIds: string[], payCategoryId?: string) =>
    api.post('/queue/approve/budget-cancel', { queueItemIds, payCategoryId }).then((r) => r.data),
  approve: (body: { queueItemIds: string[]; payCategoryId: string; baseRef?: string; budgetOverride?: boolean }) =>
    api.post<ApproveResult>('/queue/approve', body).then((r) => r.data),
}

// ─── Lookups not covered by the shared spend hooks ─────────────────────────

export const lookupKeys = {
  config: ['queue-lookups', 'app-config'] as const,
}

export const lookupsApi = {
  appConfig: () => api.get<Record<string, unknown>>('/app-config').then((r) => r.data),
}

export function configFlag(cfg: Record<string, unknown> | undefined, key: string, fallback = false): boolean {
  const v = cfg?.[key]
  if (v === undefined || v === null) return fallback
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return ['true', '1', 'yes', 'on'].includes(v.toLowerCase())
  return fallback
}

/** Pulls a human message out of an axios error (Nest returns message as string or string[]). */
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string }
  const m = e?.response?.data?.message
  if (Array.isArray(m)) return m.join(' · ')
  if (typeof m === 'string' && m) return m
  return e?.message || fallback
}

export function apiErrorCode(err: unknown): string | undefined {
  const e = err as { response?: { data?: { errors?: { code?: string } } } }
  return e?.response?.data?.errors?.code
}

export function apiErrors<T = Record<string, unknown>>(err: unknown): T | undefined {
  const e = err as { response?: { data?: { errors?: T } } }
  return e?.response?.data?.errors ?? undefined
}
