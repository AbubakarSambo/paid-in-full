import axios, { type AxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/stores/authStore'
import type {
  Batch,
  Budget,
  Customer,
  Invoice,
  LedgerEntry,
  Paginated,
  QueueItem,
  Requisition,
  User,
  Vendor,
  Wallet,
  Workspace,
} from '@/types'

const baseURL = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`

export const api = axios.create({ baseURL })

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      useAuthStore.getState().logout()
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

// ---------- Auth ----------
export interface LoginResponse {
  accessToken: string
  user: User
  workspace: Workspace
  workspaces?: Workspace[]
}
export interface RegisterPayload {
  workspaceName: string
  email: string
  password: string
  firstName: string
  lastName: string
}
export const authApi = {
  register: (payload: RegisterPayload) => api.post<LoginResponse>('/auth/register', payload).then((r) => r.data),
  login: (payload: { email: string; password: string }) =>
    api.post<LoginResponse>('/auth/login', payload).then((r) => r.data),
  switchWorkspace: (workspaceId: string) =>
    api.post(`/auth/switch-workspace/${workspaceId}`).then((r) => r.data),
}

// ---------- Users ----------
export const usersApi = {
  me: () => api.get<User>('/users/me').then((r) => r.data),
  workspaceMembers: () => api.get<User[]>('/users/workspace-members').then((r) => r.data),
}

// ---------- Workspace ----------
export const workspaceApi = {
  get: () => api.get<Workspace>('/workspace').then((r) => r.data),
  update: (payload: Partial<Workspace>) => api.patch<Workspace>('/workspace', payload).then((r) => r.data),
  addMember: (payload: { email: string; role: string }) =>
    api.post('/workspace/members', payload).then((r) => r.data),
  removeMember: (userId: string) => api.delete(`/workspace/members/${userId}`).then((r) => r.data),
}

// ---------- Vendors ----------
export interface Bank {
  code: string
  name: string
}
export const vendorsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Paginated<Vendor>>('/vendors', { params }).then((r) => r.data),
  create: (payload: Partial<Vendor>) => api.post<Vendor>('/vendors', payload).then((r) => r.data),
  get: (id: string) => api.get<Vendor>(`/vendors/${id}`).then((r) => r.data),
  update: (id: string, payload: Partial<Vendor>) =>
    api.patch<Vendor>(`/vendors/${id}`, payload).then((r) => r.data),
  remove: (id: string) => api.delete(`/vendors/${id}`).then((r) => r.data),
  banks: () => api.get<Bank[]>('/vendors/banks').then((r) => r.data),
  verifyAccount: (payload: { accountNumber: string; bankCode: string }) =>
    api.post<{ accountName: string }>('/vendors/verify-account', payload).then((r) => r.data),
}

// ---------- Requisitions ----------
export const requisitionsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Paginated<Requisition>>('/requisitions', { params }).then((r) => r.data),
  create: (payload: Partial<Requisition>) =>
    api.post<Requisition>('/requisitions', payload).then((r) => r.data),
  approve: (id: string) => api.patch<Requisition>(`/requisitions/${id}/approve`).then((r) => r.data),
  reject: (id: string, reason?: string) =>
    api.patch<Requisition>(`/requisitions/${id}/reject`, { reason }).then((r) => r.data),
  pushToQueue: (ids: string[]) => api.post('/requisitions/push-to-queue', { ids }).then((r) => r.data),
}

// ---------- Queue ----------
export const queueApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Paginated<QueueItem>>('/queue', { params }).then((r) => r.data),
  create: (payload: Partial<QueueItem>) => api.post<QueueItem>('/queue', payload).then((r) => r.data),
  update: (id: string, payload: Partial<QueueItem>) =>
    api.patch<QueueItem>(`/queue/${id}`, payload).then((r) => r.data),
  remove: (id: string) => api.delete(`/queue/${id}`).then((r) => r.data),
  addAttachment: (id: string, formData: FormData) =>
    api.post(`/queue/${id}/attachments`, formData).then((r) => r.data),
  listComments: (id: string) => api.get(`/queue/${id}/comments`).then((r) => r.data),
  addComment: (id: string, body: string) =>
    api.post(`/queue/${id}/comments`, { body }).then((r) => r.data),
  csvImport: (csvText: string) =>
    api
      .post('/queue/csv-import', csvText, { headers: { 'Content-Type': 'text/plain' } })
      .then((r) => r.data),
}

// ---------- Batches ----------
export const batchesApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Paginated<Batch>>('/batches', { params }).then((r) => r.data),
  create: (queueItemIds: string[]) => api.post<Batch>('/batches', { queueItemIds }).then((r) => r.data),
  get: (id: string) => api.get<Batch>(`/batches/${id}`).then((r) => r.data),
  approve: (id: string) => api.patch<Batch>(`/batches/${id}/approve`).then((r) => r.data),
  disburse: (id: string, clientRequestId: string) =>
    api.post(`/batches/${id}/disburse`, { clientRequestId }).then((r) => r.data),
}

// ---------- Wallet ----------
export const walletApi = {
  balance: () => api.get<Wallet>('/wallet/balance').then((r) => r.data),
  ledger: (params?: Record<string, unknown>) =>
    api.get<Paginated<LedgerEntry>>('/wallet/ledger', { params }).then((r) => r.data),
  topup: (payload: { amount: number }) => api.post('/wallet/topup', payload).then((r) => r.data),
}

// ---------- WHT ----------
export const whtApi = {
  getRates: () => api.get('/wht/rates').then((r) => r.data),
  updateRates: (payload: unknown) => api.patch('/wht/rates', payload).then((r) => r.data),
  ledger: (params?: Record<string, unknown>) => api.get('/wht/ledger', { params }).then((r) => r.data),
}

// ---------- Simple CRUD resource factory (cost-centers, departments, locations, pay-categories) ----------
function crudResource<T>(path: string) {
  return {
    list: (params?: Record<string, unknown>) =>
      api.get<Paginated<T> | T[]>(`/${path}`, { params }).then((r) => r.data),
    create: (payload: Partial<T>) => api.post<T>(`/${path}`, payload).then((r) => r.data),
    update: (id: string, payload: Partial<T>) =>
      api.patch<T>(`/${path}/${id}`, payload).then((r) => r.data),
    remove: (id: string) => api.delete(`/${path}/${id}`).then((r) => r.data),
  }
}
export const costCentersApi = crudResource<{ id: string; name: string }>('cost-centers')
export const departmentsApi = crudResource<{ id: string; name: string }>('departments')
export const locationsApi = crudResource<{ id: string; name: string }>('locations')
export const payCategoriesApi = crudResource<{ id: string; name: string }>('pay-categories')

// ---------- Budgets ----------
export const budgetsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Paginated<Budget>>('/budgets', { params }).then((r) => r.data),
  create: (payload: Partial<Budget>) => api.post<Budget>('/budgets', payload).then((r) => r.data),
  remove: (id: string) => api.delete(`/budgets/${id}`).then((r) => r.data),
  import: (csvText: string) =>
    api
      .post('/budgets/import', csvText, { headers: { 'Content-Type': 'text/plain' } })
      .then((r) => r.data),
  variance: (period: string) =>
    api.get('/budgets/variance', { params: { period } }).then((r) => r.data),
}

// ---------- Customers ----------
export const customersApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Paginated<Customer>>('/customers', { params }).then((r) => r.data),
  create: (payload: Partial<Customer>) => api.post<Customer>('/customers', payload).then((r) => r.data),
  update: (id: string, payload: Partial<Customer>) =>
    api.patch<Customer>(`/customers/${id}`, payload).then((r) => r.data),
  remove: (id: string) => api.delete(`/customers/${id}`).then((r) => r.data),
  listCredits: (id: string) => api.get(`/customers/${id}/credits`).then((r) => r.data),
  addCredit: (id: string, payload: { amount: number; note?: string }) =>
    api.post(`/customers/${id}/credits`, payload).then((r) => r.data),
}

// ---------- Invoices ----------
export const invoicesApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Paginated<Invoice>>('/invoices', { params }).then((r) => r.data),
  create: (payload: Partial<Invoice>) => api.post<Invoice>('/invoices', payload).then((r) => r.data),
  update: (id: string, payload: Partial<Invoice>) =>
    api.patch<Invoice>(`/invoices/${id}`, payload).then((r) => r.data),
  remove: (id: string) => api.delete(`/invoices/${id}`).then((r) => r.data),
  pdf: (id: string) => api.get(`/invoices/${id}/pdf`, { responseType: 'blob' }).then((r) => r.data),
  addPayment: (id: string, payload: { amount: number; method?: string }) =>
    api.post(`/invoices/${id}/payments`, payload).then((r) => r.data),
  receiptPdf: (id: string, receiptId: string) =>
    api.get(`/invoices/${id}/receipts/${receiptId}/pdf`, { responseType: 'blob' }).then((r) => r.data),
  send: (id: string) => api.post(`/invoices/${id}/send`).then((r) => r.data),
  setRecurrence: (id: string, payload: unknown) =>
    api.post(`/invoices/${id}/recurrence`, payload).then((r) => r.data),
  sweep: (id: string) => api.post(`/invoices/${id}/sweep`).then((r) => r.data),
  templates: () => api.get('/invoice-templates').then((r) => r.data),
  createTemplate: (payload: unknown) => api.post('/invoice-templates', payload).then((r) => r.data),
  fromTemplate: (templateId: string, payload?: unknown) =>
    api.post(`/invoices/from-template/${templateId}`, payload).then((r) => r.data),
}

// ---------- Billing ----------
export const billingApi = {
  plans: () => api.get('/billing/plans').then((r) => r.data),
  subscription: () => api.get('/billing/subscription').then((r) => r.data),
  upgrade: (payload: { planId: string }) =>
    api.post('/billing/subscription/upgrade', payload).then((r) => r.data),
  charge: (payload?: unknown) => api.post('/billing/subscription/charge', payload).then((r) => r.data),
}
export const customerSubscriptionsApi = crudResource<{ id: string }>('customer-subscriptions')

// ---------- Settlement ----------
export const settlementApi = {
  list: (params?: Record<string, unknown>) =>
    api.get('/settlement/batches', { params }).then((r) => r.data),
  create: (payload: unknown) => api.post('/settlement/batches', payload).then((r) => r.data),
  get: (id: string) => api.get(`/settlement/batches/${id}`).then((r) => r.data),
  addItems: (id: string, payload: unknown) =>
    api.post(`/settlement/batches/${id}/items`, payload).then((r) => r.data),
}

// ---------- Notifications ----------
export const notificationsApi = {
  getPrefs: () => api.get('/notifications/prefs').then((r) => r.data),
  updatePrefs: (payload: unknown) => api.patch('/notifications/prefs', payload).then((r) => r.data),
  subscribePush: (payload: unknown) => api.post('/notifications/push/subscribe', payload).then((r) => r.data),
  unsubscribePush: (endpoint: string) =>
    api.delete(`/notifications/push/subscribe/${encodeURIComponent(endpoint)}`).then((r) => r.data),
  vapidPublicKey: () => api.get('/notifications/push/vapid-public-key').then((r) => r.data),
}

// ---------- Reports ----------
export const reportsApi = {
  spendByCategory: (params: { startDate: string; endDate: string }) =>
    api.get('/reports/spend-by-category', { params }).then((r) => r.data),
  spendByVendor: (params: { startDate: string; endDate: string }) =>
    api.get('/reports/spend-by-vendor', { params }).then((r) => r.data),
  monthlyGrid: (year: number) => api.get('/reports/monthly-grid', { params: { year } }).then((r) => r.data),
  exportCsv: (params: { startDate: string; endDate: string }) =>
    api.get('/reports/export.csv', { params, responseType: 'blob' }).then((r) => r.data),
  exportPdf: (params: { startDate: string; endDate: string }) =>
    api.get('/reports/export.pdf', { params, responseType: 'blob' }).then((r) => r.data),
}

// ---------- AI ----------
export const aiApi = {
  suggestCategory: (payload: { description: string; amount?: number }) =>
    api.post('/ai/suggest-category', payload).then((r) => r.data),
  cleanDescription: (payload: { rawDescription: string }) =>
    api.post('/ai/clean-description', payload).then((r) => r.data),
  parseExpense: (payload: { freeText: string }) =>
    api.post('/ai/parse-expense', payload).then((r) => r.data),
}

// ---------- Client errors ----------
export const clientErrorsApi = {
  report: (payload: Record<string, unknown>) =>
    api.post('/client-errors', payload).catch(() => undefined),
}

export type ApiConfig = AxiosRequestConfig
