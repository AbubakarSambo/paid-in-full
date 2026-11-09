/** Identity / tenancy / platform types (SHELL). Mirrors api/src/modules/{auth,users,workspaces,...}. */

export type WorkspaceRoleName = 'VIEWER' | 'REQUESTER' | 'PROCUREMENT' | 'POSTER' | 'APPROVER' | 'PAYER' | 'ADMIN'
export type PlatformRoleName = 'SUPER_ADMIN' | 'CLIENT_SETUP'
export type AccentSkin = 'default' | 'classic'

export interface SessionUser {
  id: string
  email: string
  firstName: string
  lastName: string
  displayName: string
  avatarUrl: string | null
  accentSkin: AccentSkin | string | null
  onboarded: boolean
  isEmailVerified: boolean
  hasPassword: boolean
  hasPin: boolean
  platformRole: PlatformRoleName | null
  isPlatformAdmin: boolean
  role: WorkspaceRoleName | null
  isBiller: boolean
  phone?: string | null
  pinSetAt?: string | null
  googleLinked?: boolean
}

export interface SessionWorkspace {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  status: string
  role: WorkspaceRoleName | null
  isBiller: boolean
  invited?: boolean
  current?: boolean
}

export interface Session {
  accessToken: string
  user: SessionUser
  workspace: SessionWorkspace | null
  workspaces: SessionWorkspace[]
  needsOnboarding: boolean
}

export interface TokenInfo {
  type: 'INVITE' | 'PASSWORD_RESET'
  email?: string
  name: string | null
  needsName: boolean
  workspace: { id: string; name: string; logoUrl: string | null } | null
  expiresAt: string
}

export interface WorkspaceSettings {
  requisitionsEnabled: boolean
  businessUnitsRequired: boolean
  sessionTimeoutMinutes: number
  requireReauthForDisbursement: boolean
}

export interface WorkspaceDetail {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  currency: string
  timezone: string
  industry: string | null
  tin: string | null
  status: string
  invoicePrefix?: string
  taxRate?: number | string
  trialEndDate?: string | null
  createdAt: string
  monnifyReservedAccountNumber: string | null
  monnifyReservedAccountName: string | null
  monnifyReservedAccountBank: string | null
  settings: WorkspaceSettings
  options: { currencies: string[]; industries: string[] }
}

export interface Member {
  id: string
  userId: string
  email: string
  firstName: string
  lastName: string
  displayName: string
  avatarUrl: string | null
  role: WorkspaceRoleName
  isBiller: boolean
  status: 'active' | 'invited'
  hasPin: boolean
  invitedAt: string | null
  joinedAt: string | null
}

export interface InviteResult {
  userId: string
  email: string
  role: WorkspaceRoleName
  isBiller: boolean
  status: 'invited'
  emailSent: boolean
  inviteUrl?: string
}

export interface ChecklistStep {
  key: string
  label: string
  done: boolean
  autoDetected: boolean
  manuallyTicked: boolean
  canAutoDetect: boolean
  optional: boolean
}

export interface Checklist {
  steps: ChecklistStep[]
  completed: number
  total: number
  percent: number
  allDone: boolean
  dismissed: boolean
  wizardDone: boolean
}

export interface ActivityItem {
  id: string
  action: string
  title: string
  summary: string
  actorName: string
  isMine: boolean
  createdAt: string
  timeAgo: string
  entityType?: string | null
  entityId?: string | null
}

export interface AuditLogRow {
  id: string
  createdAt: string
  action: string
  actionLabel: string
  target: string | null
  actorEmail: string | null
  actorName: string
  metadata: unknown
}

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'PUSH'

export interface NotificationPrefs {
  events: Array<{ key: string; label: string }>
  channels: NotificationChannel[]
  matrix: Record<string, Record<NotificationChannel, boolean>>
  push: { subscribed: boolean; subscriptions: number; configured: boolean; vapidPublicKey: string | null }
}

export interface PinStatus {
  hasPin: boolean
  pinSetAt: string | null
  lockedUntil: string | null
  message: string
}

export interface PifSubscription {
  tier: string | null
  monthlyAmount: number | null
  status: string
  paused: boolean
  nextDueDate: string | null
  paidUntil: string | null
  trialEndDate: string | null
  overdue: boolean
  daysOverdue?: number
  graceEndsAt: string | null
  billingDay: number
  rule: string
  billingAccount: { accountNumber: string; accountName: string | null; bankName: string | null } | null
  payments: Array<{ id: string; amount: number; reference: string | null; paidAt: string }>
}

export interface WalletBalance {
  balance: number
  readyToSend: number
  clearing: number
  [key: string]: unknown
}

export interface WalletAccount {
  accountNumber: string
  accountName: string | null
  bankName: string | null
  accountReference?: string | null
  contractCode?: string | null
}

export interface WalletSummary extends WalletBalance {
  health?: { status: string; label: string; message: string; needed: number }
  inflows24h?: { amount: number; count: number }
  account?: WalletAccount | null
  /** True when the API runs Monnify in mock mode — enables the "Simulate payment" top-up. */
  mockMode?: boolean
}

export interface SheetsStatus {
  configured: boolean
  reason: string | null
  transport: string | null
  status: 'Not synced' | 'Syncing' | 'Synced' | 'Error' | string
  lastSyncedAt: string | null
  lastError: string | null
  lastMessage: string | null
  unsyncedBatches: number
  mockMode?: boolean
}

// ── Super admin ──
export type WorkspaceStatusName = 'LEAD' | 'TRIAL' | 'ACTIVE' | 'DEAD' | 'PAUSED' | 'SUSPENDED'

export interface SuperAdminKpis {
  totalClients: number
  activeClients: number
  trialClients: number
  pausedClients: number
  monthlyRecurring?: number
}

export interface ClientRow {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  status: WorkspaceStatusName
  tier: string | null
  billingDay: number | null
  paidUntil: string | null
  nextDueDate: string | null
  overdue: boolean
  graceEndsAt: string | null
  trialEndDate: string | null
  notes: string | null
  members: number
  batches: number
  lastActivityAt: string | null
  createdAt: string
  monthlyAmount?: number | null
  totalDisbursed?: number
  admins?: Array<{ id: string; email: string; name: string; status: string }>
}

export interface ManageClientPayload {
  status?: WorkspaceStatusName
  monthlyAmount?: number | null
  paidUntil?: string | null
  extendPaidUntil?: '30d' | '90d' | '1y'
  trialEndDate?: string | null
  tier?: string | null
  billingDay?: number | null
  nextDueDate?: string | null
  notes?: string | null
}

export interface PlatformTeamMember {
  id: string
  email: string
  name: string
  platformRole: PlatformRoleName
  createdAt: string
}

export interface AutoDebitOverview {
  summary: {
    subscriptions: number
    activeMandates: number
    pendingMandates: number
    settledCharges: number
    gross: number
    fees: number
    net: number
  }
  subscriptions: Array<{
    id: string
    workspace: { id: string; name: string }
    customer: { id: string; name: string } | null
    planName: string
    amount: number | null
    interval: string
    status: string
    nextRunAt: string | null
    lastChargedAt: string | null
    mandateType: string | null
    mandateReference: string | null
    cardLast4: string | null
    authorisedAt: string | null
  }>
  mandates: AutoDebitOverview['subscriptions']
  settlements: Array<{
    id: string
    reference: string
    workspace: { id: string; name: string }
    customer: { id: string; name: string } | null
    planName: string
    gross: number | null
    fee: number | null
    net: number | null
    settledAt: string
  }>
}
