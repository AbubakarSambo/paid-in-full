import { api } from '@/lib/api'
import type {
  CreateRequisitionBundlePayload,
  CreateRequisitionPayload,
  DepartmentSuggestion,
  PushLinePayload,
  RequisitionAttachment,
  RequisitionDetail,
  RequisitionFilter,
  RequisitionListResponse,
  RequisitionRow,
} from '@/types/requisitions'

export const requisitionKeys = {
  all: ['requisitions'] as const,
  list: (filter: RequisitionFilter, search: string, page: number) => ['requisitions', 'list', filter, search, page] as const,
  detail: (id: string) => ['requisitions', 'detail', id] as const,
}

type ReviewBody = { reviewNote?: string; wholeBundle?: boolean }

export const requisitionsApi = {
  list: (q: { filter: RequisitionFilter; search?: string; page?: number; limit?: number }) =>
    api
      .get<RequisitionListResponse>('/requisitions', {
        params: { filter: q.filter, search: q.search || undefined, page: q.page ?? 1, limit: q.limit ?? 50 },
      })
      .then((r) => r.data),
  get: (id: string) => api.get<RequisitionDetail>(`/requisitions/${id}`).then((r) => r.data),
  create: (payload: CreateRequisitionPayload) => api.post<RequisitionDetail>('/requisitions', payload).then((r) => r.data),
  createBundle: (payload: CreateRequisitionBundlePayload) =>
    api.post<RequisitionRow[]>('/requisitions/bundle', payload).then((r) => r.data),
  update: (id: string, payload: Partial<CreateRequisitionPayload> & { bundleLabel?: string }) =>
    api.patch<RequisitionDetail>(`/requisitions/${id}`, payload).then((r) => r.data),
  remove: (id: string) => api.delete(`/requisitions/${id}`).then((r) => r.data),
  submit: (id: string, body: ReviewBody = {}) => api.post(`/requisitions/${id}/submit`, body).then((r) => r.data),
  clear: (id: string, body: ReviewBody = {}) => api.post(`/requisitions/${id}/clear`, body).then((r) => r.data),
  returnToRequester: (id: string, body: ReviewBody) => api.post(`/requisitions/${id}/return`, body).then((r) => r.data),
  reject: (id: string, body: ReviewBody) => api.post(`/requisitions/${id}/reject`, body).then((r) => r.data),
  undo: (id: string, body: ReviewBody = {}) => api.post(`/requisitions/${id}/undo`, body).then((r) => r.data),
  pushToQueue: (lines: PushLinePayload[], applyToAll?: Omit<PushLinePayload, 'requisitionId' | 'whtRateOverride'>) =>
    api
      .post<{ pushed: string[]; queueItemIds: string[] }>('/requisitions/push-to-queue', { lines, applyToAll })
      .then((r) => r.data),
  uploadAttachment: (id: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<RequisitionAttachment>(`/requisitions/${id}/attachments`, fd).then((r) => r.data)
  },
  attachments: (id: string) => api.get<RequisitionAttachment[]>(`/requisitions/${id}/attachments`).then((r) => r.data),
  departmentSuggestions: (q: string) =>
    api.get<DepartmentSuggestion[]>('/departments/suggestions', { params: { q: q || undefined } }).then((r) => r.data),
}
