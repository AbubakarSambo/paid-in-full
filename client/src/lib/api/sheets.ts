import { api } from '@/lib/api'
import type {
  ReconReport,
  SaveSheetsConfig,
  SheetsConfig,
  SheetsStatus,
  SheetsSyncResult,
  SheetsTestResult,
} from '@/types/reports'

export const sheetsApi = {
  status: () => api.get<SheetsStatus>('/sheets/status').then((r) => r.data),
  getConfig: () => api.get<SheetsConfig>('/sheets/config').then((r) => r.data),
  saveConfig: (dto: SaveSheetsConfig) => api.put<SheetsConfig>('/sheets/config', dto).then((r) => r.data),
  test: (target: 'batches' | 'invoices') => api.post<SheetsTestResult>('/sheets/test', { target }).then((r) => r.data),
  resyncBatch: (id: string) => api.post<SheetsSyncResult>(`/sheets/batches/${id}/resync`).then((r) => r.data),
  resyncInvoice: (id: string) => api.post<SheetsSyncResult>(`/sheets/invoices/${id}/resync`).then((r) => r.data),
  backfill: (from: string) => api.post<SheetsSyncResult>('/sheets/backfill', { from }).then((r) => r.data),
  wipeRepush: () => api.post<SheetsSyncResult>('/sheets/wipe-repush', { confirm: true }).then((r) => r.data),
  recon: () => api.get<ReconReport>('/sheets/recon').then((r) => r.data),
  reconFill: () =>
    api.post<{ ok: boolean; filled: number; mock?: boolean; message?: string }>('/sheets/recon/fill').then((r) => r.data),
}
