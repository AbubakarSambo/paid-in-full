import { api } from '@/lib/api'
import type {
  ActivityItem,
  AuditLogRow,
  AutoDebitOverview,
  Checklist,
  ClientRow,
  InviteResult,
  ManageClientPayload,
  Member,
  NotificationChannel,
  NotificationPrefs,
  PifSubscription,
  PinStatus,
  PlatformTeamMember,
  Session,
  SessionUser,
  SessionWorkspace,
  SheetsStatus,
  SuperAdminKpis,
  TokenInfo,
  WalletBalance,
  WalletSummary,
  WorkspaceDetail,
  WorkspaceRoleName,
  WorkspaceStatusName,
} from '@/types/shell'

const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data)

/** Pull a friendly message + code out of an API error ({message, errors:{code}}). */
export function apiError(err: unknown, fallback = 'Something went wrong. Try again.'): { message: string; code?: string; status?: number } {
  const e = err as { response?: { status?: number; data?: { message?: string | string[]; errors?: { code?: string } } }; message?: string; code?: string }
  if (!e?.response) {
    if (e?.code === 'ERR_NETWORK' || e?.message === 'Network Error') {
      return { message: "Can't reach Paid in Full right now. Check your internet connection and try again.", code: 'NETWORK' }
    }
    return { message: e?.message || fallback }
  }
  const { status, data: body } = e.response
  if (status === 429) return { message: 'Too many attempts. Wait a minute and try again.', code: 'RATE_LIMITED', status }
  const raw = body?.message
  const message = Array.isArray(raw) ? raw[0] : raw
  return { message: message || fallback, code: body?.errors?.code, status }
}

export const authApi = {
  login: (p: { email: string; password: string }) => data(api.post<Session>('/auth/login', p)),
  register: (p: { name: string; workspaceName: string; email: string; password: string }) => data(api.post<Session>('/auth/register', p)),
  google: (p: { idToken: string; workspaceName?: string }) => data(api.post<Session>('/auth/google', p)),
  forgotPassword: (email: string) => data(api.post<{ sent: boolean; message: string }>('/auth/forgot-password', { email })),
  resendConfirmation: (email: string) => data(api.post<{ sent: boolean; message: string }>('/auth/resend-confirmation', { email })),
  verifyEmail: (token: string) => data(api.post<{ verified: boolean }>('/auth/verify-email', { token })),
  tokenInfo: (token: string) => data(api.get<TokenInfo>(`/auth/token/${encodeURIComponent(token)}`)),
  setPassword: (p: { token: string; password: string; name?: string }) => data(api.post<Session>('/auth/set-password', p)),
  resetPassword: (p: { token: string; password: string }) => data(api.post<Session>('/auth/reset-password', p)),
  session: () => data(api.get<Session>('/auth/session')),
  workspaces: () => data(api.get<SessionWorkspace[]>('/auth/workspaces')),
  createWorkspace: (name: string) => data(api.post<Session>('/auth/workspaces', { name })),
  switchWorkspace: (id: string) => data(api.post<Session>(`/auth/switch-workspace/${id}`)),
}

export const meApi = {
  get: () => data(api.get<SessionUser>('/me')),
  update: (p: Partial<{ displayName: string; firstName: string; lastName: string; phone: string; accentSkin: 'default' | 'classic'; onboarded: boolean }>) =>
    data(api.patch<SessionUser>('/me', p)),
  uploadAvatar: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return data(api.post<SessionUser>('/me/avatar', fd))
  },
  removeAvatar: () => data(api.delete<SessionUser>('/me/avatar')),
  changePassword: (p: { currentPassword?: string; newPassword: string }) => data(api.post<{ changed: boolean }>('/me/password', p)),
  pinStatus: () => data(api.get<PinStatus>('/me/pin')),
  setPin: (p: { pin: string; currentPin?: string }) => data(api.put<PinStatus>('/me/pin', p)),
  resetPin: (p: { password: string; pin: string }) => data(api.post<PinStatus>('/me/pin/reset', p)),
}

export const membersApi = {
  list: () => data(api.get<Member[]>('/users')),
  invite: (p: { name: string; email: string; role: WorkspaceRoleName; isBiller?: boolean }) => data(api.post<InviteResult>('/users/invite', p)),
  resendInvite: (userId: string) => data(api.post<{ emailSent: boolean; inviteUrl?: string }>(`/users/${userId}/resend-invite`)),
  editName: (userId: string, name: string) => data(api.patch(`/users/${userId}`, { name })),
  setRole: (userId: string, role: WorkspaceRoleName) => data(api.patch(`/users/${userId}/role`, { role })),
  setBiller: (userId: string, isBiller: boolean) => data(api.patch(`/users/${userId}/biller`, { isBiller })),
  remove: (userId: string) => data(api.delete(`/users/${userId}`)),
}

export interface UpdateWorkspacePayload {
  name?: string
  logoUrl?: string | null
  currency?: string
  timezone?: string
  industry?: string
  tin?: string
  requisitionsEnabled?: boolean
  businessUnitsRequired?: boolean
  sessionTimeoutMinutes?: number
  requireReauthForDisbursement?: boolean
}

export const workspaceShellApi = {
  get: () => data(api.get<WorkspaceDetail>('/workspace')),
  update: (p: UpdateWorkspacePayload) => data(api.patch<WorkspaceDetail>('/workspace', p)),
  uploadLogo: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return data(api.post<WorkspaceDetail>('/workspace/logo', fd))
  },
}

export interface WizardPayload {
  name?: string
  logoUrl?: string
  currency?: string
  timezone?: string
  industry?: string
  createDefaultCategories?: boolean
  invites?: Array<{ email: string; name: string; role: WorkspaceRoleName }>
}

export const onboardingApi = {
  wizard: (p: WizardPayload) =>
    data(api.post<{ done: boolean; categoriesCreated: number; coaTagsCreated: number; invites: Array<{ email: string; ok: boolean; error?: string }> }>('/onboarding/wizard', p)),
  checklist: () => data(api.get<Checklist>('/onboarding/checklist')),
  setStep: (key: string, done: boolean) => data(api.patch<Checklist>(`/onboarding/checklist/${key}`, { done })),
  dismiss: (dismissed: boolean) => data(api.post<Checklist>('/onboarding/checklist/dismiss', { dismissed })),
}

export const activityApi = {
  feed: (limit = 30) => data(api.get<ActivityItem[]>('/activity', { params: { limit } })),
  auditLog: () => data(api.get<AuditLogRow[]>('/audit-log')),
}

export const notificationPrefsApi = {
  get: () => data(api.get<NotificationPrefs>('/notifications/prefs')),
  update: (prefs: Array<{ event: string; channel: NotificationChannel; isEnabled: boolean }>) =>
    data(api.patch<NotificationPrefs>('/notifications/prefs', { prefs })),
  vapidKey: () => data(api.get<{ vapidPublicKey: string | null }>('/notifications/push/vapid-public-key')),
  subscribe: (p: { endpoint: string; p256dhKey: string; authKey: string; platform?: 'WEB' | 'ANDROID' | 'IOS' }) =>
    data(api.post('/notifications/push/subscribe', p)),
  unsubscribe: (endpoint?: string) => data(api.post('/notifications/push/unsubscribe', { endpoint })),
  test: () => data(api.post<{ sent: number; subscriptions: number; mock: boolean }>('/notifications/test')),
}

/** Header wallet pill. Coded defensively: the batches agent may reshape these. */
export const walletShellApi = {
  summary: () => data(api.get<WalletSummary>('/wallet')),
  balance: () => data(api.get<WalletBalance>('/wallet/balance')),
  simulateTopup: (amount: number) =>
    data(api.post<{ reference: string }>('/wallet/topup', { amount, clientRequestId: crypto.randomUUID() })),
  reconcileTopups: () => data(api.post<{ checked: number; added?: number; message: string }>('/wallet/topups/reconcile')),
}

export const sheetsShellApi = {
  status: () => data(api.get<SheetsStatus>('/sheets/status')),
}

export const pifBillingApi = {
  get: () => data(api.get<PifSubscription>('/billing/pif-subscription')),
  provisionAccount: (p: { bvn?: string; nin?: string }) => data(api.post<PifSubscription>('/billing/pif-subscription/account', p)),
}

export const superAdminApi = {
  kpis: () => data(api.get<SuperAdminKpis>('/super-admin/kpis')),
  clients: (p: { search?: string; status?: WorkspaceStatusName | '' }) =>
    data(api.get<ClientRow[]>('/super-admin/clients', { params: { search: p.search || undefined, status: p.status || undefined } })),
  client: (id: string) => data(api.get<ClientRow>(`/super-admin/clients/${id}`)),
  newClient: (p: { businessName: string; slug?: string; adminName: string; adminEmail: string; monthlyAmount?: number }) =>
    data(api.post<{ id: string; name: string; slug: string; status: string; admin: { emailSent?: boolean; inviteUrl?: string } }>('/super-admin/clients', p)),
  manage: (id: string, p: ManageClientPayload) => data(api.patch<ClientRow>(`/super-admin/clients/${id}`, p)),
  remove: (id: string, confirmName: string) => data(api.delete(`/super-admin/clients/${id}`, { data: { confirmName } })),
  open: (id: string) => data(api.post<Session>(`/super-admin/clients/${id}/open`)),
  team: () => data(api.get<PlatformTeamMember[]>('/super-admin/team')),
  grant: (email: string) => data(api.post('/super-admin/team/grant', { email })),
  revoke: (email: string) => data(api.post('/super-admin/team/remove', { email })),
  autoDebit: () => data(api.get<AutoDebitOverview>('/super-admin/auto-debit')),
}
