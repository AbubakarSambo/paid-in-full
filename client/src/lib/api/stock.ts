import { api } from '@/lib/api'
import { downloadFile } from '@/lib/api/spend'
import type { StockImportResult, StockInput, StockItem } from '@/types/vendors'

export const stockApi = {
  /** active=true → picker list; omit for everything. */
  list: (q: { search?: string; active?: boolean } = {}) => api.get<StockItem[]>('/stock', { params: q }).then((r) => r.data),
  create: (body: StockInput) => api.post<StockItem>('/stock', body).then((r) => r.data),
  update: (id: string, body: Partial<StockInput>) => api.patch<StockItem>(`/stock/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/stock/${id}`).then((r) => r.data),
  importCsv: (csv: string) => api.post<StockImportResult>('/stock/import', { csv }).then((r) => r.data),
  downloadTemplate: () => downloadFile('/stock/template.csv', 'stock-template.csv'),
}
