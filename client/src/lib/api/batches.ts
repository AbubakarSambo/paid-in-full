import { api } from '@/lib/api'
import { downloadBlob } from '@/lib/utils'
import type {
  BatchDetail,
  BatchFilter,
  BatchListResponse,
  CheckStatusResult,
  DisburseInput,
  DisbursePreview,
  DisbursePreviewInput,
  DisburseRecovery,
  DisburseResult,
  ManualExpenseInput,
  ManualExpenseResult,
  ReclassifyInput,
  RetryResult,
  SplitInput,
  StatementConfirmResult,
  StatementMatchInput,
  StatementPreview,
  WhatsappLink,
} from '@/types/batches'

const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data)
const enc = encodeURIComponent

/** Fetches a binary endpoint and saves it. Errors from blob responses are decoded by `apiErrorMessage`. */
async function download(path: string, filename: string, params?: Record<string, string | undefined>) {
  const r = await api.get<Blob>(path, { responseType: 'blob', params })
  downloadBlob(r.data, filename)
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

export const batchKeys = {
  all: ['batches'] as const,
  list: (search: string, status: BatchFilter) => ['batches', 'list', search, status] as const,
  detail: (id: string) => ['batches', 'detail', id] as const,
}

export const batchesApi = {
  list: (params: { search?: string; status?: BatchFilter }) =>
    data(api.get<BatchListResponse>('/batches', { params: { search: params.search || undefined, status: params.status || undefined } })),
  get: (id: string) => data(api.get<BatchDetail>(`/batches/${id}`)),

  // Money movement (payer)
  previewDisburse: (id: string, body: DisbursePreviewInput) => data(api.post<DisbursePreview>(`/batches/${id}/disburse/preview`, body)),
  /** No client timeout: the server keeps the request open until each chunk of transfers is sent. */
  disburse: (id: string, body: DisburseInput) => data(api.post<DisburseResult>(`/batches/${id}/disburse`, body, { timeout: 0 })),
  recovery: (id: string, clientRequestId: string) => data(api.get<DisburseRecovery>(`/batches/${id}/disbursements/${clientRequestId}`)),
  checkStatus: (id: string) => data(api.post<CheckStatusResult>(`/batches/${id}/check-status`)),
  retry: (id: string, itemIds?: string[]) => data(api.post<RetryResult>(`/batches/${id}/retry`, itemIds?.length ? { itemIds } : {})),

  // Batch actions
  cancel: (id: string, reason?: string) =>
    data(api.post<{ cancelled: boolean; returned: number }>(`/batches/${id}/cancel`, reason ? { reason } : {})),
  remove: (id: string) => data(api.delete<{ deleted: boolean }>(`/batches/${id}`)),
  renameBundle: (id: string, bundleKey: string, label: string) =>
    data(api.patch<{ renamed: number; bundleKey: string; label: string }>(`/batches/${id}/bundles/${enc(bundleKey)}`, { label })),
  resyncSheet: (id: string) => data(api.post<{ ok: boolean; message?: string }>(`/sheets/batches/${id}/resync`)),

  // Line actions (approver)
  cancelLine: (id: string, itemId: string, reason?: string) => data(api.post(`/batches/${id}/items/${itemId}/cancel`, reason ? { reason } : {})),
  returnLine: (id: string, itemId: string) => data(api.post<{ returned: boolean }>(`/batches/${id}/items/${itemId}/return`)),
  splitLine: (id: string, itemId: string, body: SplitInput) =>
    data(api.post<{ itemId: string; newItemId: string; payNow: number; remainder: number }>(`/batches/${id}/items/${itemId}/split`, body)),
  reclassify: (id: string, itemId: string, body: ReclassifyInput) =>
    data(api.patch<{ changes: Record<string, unknown> }>(`/batches/${id}/items/${itemId}`, body)),

  logManualExpense: (body: ManualExpenseInput) => data(api.post<ManualExpenseResult>('/batches/manual-expense', body)),

  // Receipts
  whatsapp: (id: string, itemId: string) => data(api.get<WhatsappLink>(`/batches/${id}/items/${itemId}/whatsapp`)),
  downloadBatchReceipt: (id: string, ref: string) => download(`/batches/${id}/receipt.pdf`, `${safeName(ref)}-receipt.pdf`),
  downloadBatchZip: (id: string, ref: string) => download(`/batches/${id}/receipts.zip`, `${safeName(ref)}-receipts.zip`),
  downloadBundleReceipt: (id: string, bundleKey: string, label: string) =>
    download(`/batches/${id}/bundles/${enc(bundleKey)}/receipt.pdf`, `${safeName(label)}-bulk-receipt.pdf`),
  downloadLineReceipt: (id: string, itemId: string, vendor: string) =>
    download(`/batches/${id}/items/${itemId}/receipt.pdf`, `${safeName(vendor)}-receipt.pdf`),
  exportAllReceipts: (from?: string, to?: string) => download('/batches/receipts/export.zip', 'paid-receipts.zip', { from, to }),
}

/** What the disburse confirmation needs to know about the current user / workspace. */
export const disburseAuthApi = {
  pinStatus: () => data(api.get<{ hasPin: boolean; lockedUntil: string | null; message: string }>('/me/pin')),
  requiresReauth: () =>
    data(api.get<{ key: string; value: unknown }>('/app-config/require_reauth_for_disbursement')).then((r) => r.value === true),
}

// ─── In-flight disbursement persistence (sessionStorage) ───
// The clientRequestId of a submitted disbursement is kept until the true outcome is known, so a
// reload or a dropped connection resumes by polling the recovery endpoint instead of paying again.

const INFLIGHT_PREFIX = 'pif:disburse:'

export interface InflightDisbursement {
  batchId: string
  batchRef: string
  clientRequestId: string
  startedAt: number
}

export const inflightStore = {
  save(v: InflightDisbursement) {
    try {
      sessionStorage.setItem(INFLIGHT_PREFIX + v.batchId, JSON.stringify(v))
    } catch {
      /* storage unavailable: recovery still works while the modal stays open */
    }
  },
  clear(batchId: string) {
    try {
      sessionStorage.removeItem(INFLIGHT_PREFIX + batchId)
    } catch {
      /* ignore */
    }
  },
  get(batchId: string): InflightDisbursement | null {
    try {
      const raw = sessionStorage.getItem(INFLIGHT_PREFIX + batchId)
      return raw ? (JSON.parse(raw) as InflightDisbursement) : null
    } catch {
      return null
    }
  },
  /** First in-flight disbursement in this tab, if any (resumed when the Batches page mounts). */
  first(): InflightDisbursement | null {
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i)
        if (k?.startsWith(INFLIGHT_PREFIX)) {
          const v = JSON.parse(sessionStorage.getItem(k) ?? 'null') as InflightDisbursement | null
          if (v?.clientRequestId && v.batchId) return v
        }
      }
    } catch {
      /* ignore */
    }
    return null
  },
}

export const statementApi = {
  preview: (csv: string) => data(api.post<StatementPreview>('/settlement/statement/preview', { csv })),
  confirm: (matches: StatementMatchInput[]) => data(api.post<StatementConfirmResult>('/settlement/statement/confirm', { matches })),
}

/** Friendly message from an axios error (handles JSON and Blob bodies, validation arrays, network failures). */
export async function apiErrorMessage(err: unknown, fallback = 'Something went wrong. Try again.'): Promise<string> {
  const e = err as { response?: { status?: number; data?: unknown }; message?: string; code?: string }
  if (!e?.response) {
    if (e?.code === 'ERR_NETWORK' || e?.message === 'Network Error') return "Can't reach Paid in Full. Check your connection and try again."
    return e?.message || fallback
  }
  let body = e.response.data as { message?: string | string[] } | Blob | undefined
  if (body instanceof Blob) {
    try {
      body = JSON.parse(await body.text()) as { message?: string | string[] }
    } catch {
      body = undefined
    }
  }
  if (e.response.status === 429) return 'Too many attempts. Wait a minute and try again.'
  const raw = (body as { message?: string | string[] } | undefined)?.message
  const msg = Array.isArray(raw) ? raw[0] : raw
  return msg || fallback
}

/** True when the request may have reached the server but we never got an answer (outcome unknown). */
export function isOutcomeUnknown(err: unknown): boolean {
  const e = err as { response?: { status?: number }; code?: string }
  if (!e?.response) return true // network drop, timeout, CORS failure on a gateway error page
  const s = e.response.status ?? 0
  return s >= 500 || s === 409 // 409 = "already being processed" for this clientRequestId
}
