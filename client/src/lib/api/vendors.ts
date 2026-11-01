import { api } from '@/lib/api'
import { downloadFile } from '@/lib/api/spend'
import type {
  Bank,
  BulkVendorCommitResult,
  BulkVendorPreview,
  NameEnquiryResult,
  Vendor,
  VendorInput,
  VendorListResponse,
  VendorTagCount,
} from '@/types/vendors'

export interface VendorListQuery {
  search?: string
  tag?: string
  page?: number
  limit?: number
  includeInactive?: boolean
}

export const vendorsApi = {
  list: (q: VendorListQuery = {}) => api.get<VendorListResponse>('/vendors', { params: q }).then((r) => r.data),
  /** Every active vendor (walks the 100-per-page API). Used by pickers. */
  listAll: async (): Promise<Vendor[]> => {
    const out: Vendor[] = []
    for (let page = 1; page <= 50; page++) {
      const r = await vendorsApi.list({ page, limit: 100 })
      out.push(...r.data)
      if (page >= r.meta.totalPages) break
    }
    return out
  },
  get: (id: string) => api.get<Vendor>(`/vendors/${id}`).then((r) => r.data),
  banks: () => api.get<Bank[]>('/vendors/banks').then((r) => r.data),
  tags: () => api.get<VendorTagCount[]>('/vendors/tags').then((r) => r.data),
  verifyAccount: (accountNumber: string, bankCode: string) =>
    api.post<NameEnquiryResult>('/vendors/verify-account', { accountNumber, bankCode }).then((r) => r.data),
  create: (body: VendorInput) => api.post<Vendor>('/vendors', body).then((r) => r.data),
  update: (id: string, body: Partial<VendorInput>) => api.patch<Vendor>(`/vendors/${id}`, body).then((r) => r.data),
  recheck: (id: string) =>
    api.post<{ verified: boolean; reason?: string; vendor: Vendor }>(`/vendors/${id}/recheck`).then((r) => r.data),
  remove: (id: string) => api.delete<{ success: boolean; deactivated: boolean }>(`/vendors/${id}`).then((r) => r.data),
  bulkPreview: (csv: string) => api.post<BulkVendorPreview>('/vendors/bulk/preview', { csv }).then((r) => r.data),
  bulkCommit: (csv: string) => api.post<BulkVendorCommitResult>('/vendors/bulk/commit', { csv }).then((r) => r.data),
  downloadTemplate: () => downloadFile('/vendors/template.csv', 'vendors-template.csv'),
  exportCsv: (q: { search?: string; tag?: string } = {}) => downloadFile('/vendors/export.csv', 'vendors.csv', q),
  exportPdf: (q: { search?: string; tag?: string } = {}) => downloadFile('/vendors/export.pdf', 'vendors.pdf', q),
}
