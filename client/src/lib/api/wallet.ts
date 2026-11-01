import { api } from '@/lib/api'
import type {
  LedgerQuery,
  LinkAccountInput,
  PageOf,
  ProvisionAccountInput,
  ReconcileTopupsResult,
  WalletAccountInfo,
  WalletBalance,
  WalletLedgerRow,
  WalletSummary,
  WalletTopupRow,
} from '@/types/wallet'

const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data)

/** Every key starts with 'wallet' so invalidating ['wallet'] also refreshes the header pill. */
export const walletKeys = {
  all: ['wallet'] as const,
  summary: ['wallet', 'summary'] as const,
  balance: ['wallet', 'balance'] as const,
  ledger: (q: LedgerQuery) => ['wallet', 'ledger', q] as const,
  topups: (page: number) => ['wallet', 'topups', page] as const,
}

export const walletApi = {
  summary: () => data(api.get<WalletSummary>('/wallet')),
  balance: () => data(api.get<WalletBalance>('/wallet/balance')),
  ledger: (q: LedgerQuery) => data(api.get<PageOf<WalletLedgerRow>>('/wallet/ledger', { params: q })),
  topups: (page = 1, limit = 20) => data(api.get<PageOf<WalletTopupRow>>('/wallet/topups', { params: { page, limit } })),
  reconcileTopups: () => data(api.post<ReconcileTopupsResult>('/wallet/topups/reconcile')),

  // Reserved account (admin)
  provision: (body: ProvisionAccountInput) => data(api.post<WalletAccountInfo>('/wallet/account/provision', body)),
  link: (body: LinkAccountInput) => data(api.post<WalletAccountInfo>('/wallet/account/link', body)),
  rename: (accountName?: string) => data(api.patch<WalletAccountInfo>('/wallet/account', accountName ? { accountName } : {})),
  unlink: () => data(api.delete<{ unlinked: boolean }>('/wallet/account')),
}
