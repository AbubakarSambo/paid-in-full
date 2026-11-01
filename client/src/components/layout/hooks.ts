import { useQuery } from '@tanstack/react-query'
import { workspaceShellApi, walletShellApi, sheetsShellApi } from '@/lib/api/shell'
import { useAuthStore } from '@/stores/authStore'
import type { WalletSummary } from '@/types/shell'

/** GET /workspace: profile + app-config driven settings (requisitions toggle, session timeout…). */
export function useWorkspaceConfig() {
  const workspaceId = useAuthStore((s) => s.workspace?.id)
  return useQuery({
    queryKey: ['workspace'],
    queryFn: workspaceShellApi.get,
    enabled: !!workspaceId,
    staleTime: 5 * 60_000,
  })
}

/** Wallet summary for the header pill. Falls back to /wallet/balance if /wallet changes shape or fails. */
export function useWalletSummary() {
  const workspaceId = useAuthStore((s) => s.workspace?.id)
  return useQuery({
    queryKey: ['wallet', 'summary', 'shell'],
    enabled: !!workspaceId,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async (): Promise<WalletSummary | null> => {
      try {
        const s = await walletShellApi.summary()
        if (s && typeof s === 'object' && ('balance' in s || 'readyToSend' in s)) return s
      } catch {
        /* fall through */
      }
      try {
        return await walletShellApi.balance()
      } catch {
        return null
      }
    },
  })
}

export function useSheetsStatus() {
  const workspaceId = useAuthStore((s) => s.workspace?.id)
  return useQuery({
    queryKey: ['sheets', 'status'],
    queryFn: sheetsShellApi.status,
    enabled: !!workspaceId,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
  })
}

/** Number helper tolerant of Decimal strings. */
export const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : 0
}
