// Wallet types. Mirrors api/src/modules/wallet (GET /wallet, /wallet/ledger, /wallet/topups …).

export interface WalletBalance {
  workspaceId: string
  /** Confirmed credits − (completed + in-flight debits). */
  balance: number
  readyToSend: number
  clearing: number
  confirmedCredits: number
  completedDebits: number
  inFlightDebits: number
}

export interface WalletAccountInfo {
  accountNumber: string
  accountName: string | null
  bankName: string | null
  accountReference: string | null
  contractCode: string | null
}

export type WalletHealthStatus = 'HEALTHY' | 'ATTENTION' | 'ACTION_NEEDED'

export interface WalletSummary extends WalletBalance {
  health: { status: WalletHealthStatus; label: string; message: string; needed: number }
  inflows24h: { amount: number; count: number }
  account: WalletAccountInfo | null
}

export type LedgerType = 'TOPUP' | 'SWEEP_IN' | 'DISBURSEMENT' | 'FEE' | 'REFUND' | 'ADJUSTMENT' | 'WHT_WITHHOLDING'
export type LedgerDirection = 'IN' | 'OUT'
export type LedgerStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED'

export interface WalletLedgerRow {
  id: string
  type: LedgerType
  direction: LedgerDirection
  status: LedgerStatus
  /** Signed: + in, − out. */
  amount: string | number
  balanceBefore: string | number | null
  balanceAfter: string | number | null
  batchId: string | null
  batch: { batchRef: string } | null
  reference: string | null
  sourceType: string | null
  description: string | null
  actorUserId: string | null
  actorName: string | null
  postedAt: string
}

export type TopupSource = 'WEBHOOK' | 'MANUAL_RECONCILIATION' | 'CARD'

export interface WalletTopupRow {
  id: string
  amount: string | number
  reference: string
  payerName: string | null
  payerBank: string | null
  payerAccountNumber: string | null
  source: TopupSource
  status: string
  paidAt: string | null
  createdAt: string
}

export interface PageMeta {
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface PageOf<T> {
  data: T[]
  meta: PageMeta
}

export interface LedgerQuery {
  page?: number
  limit?: number
  type?: LedgerType
  direction?: LedgerDirection
  status?: LedgerStatus
}

export interface ReconcileTopupsResult {
  checked: number
  added: number
  addedAmount: number
  message: string
}

export interface ProvisionAccountInput {
  accountName?: string
  contractCode?: string
  currency?: 'NGN'
  customerName?: string
  customerEmail?: string
  bvn?: string
  nin?: string
}

export interface LinkAccountInput {
  accountReference: string
  accountNumber?: string
  bankName?: string
  accountName?: string
}
