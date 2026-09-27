import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { queryClient } from '@/lib/queryClient'
import type { User, Workspace } from '@/types'

interface AuthState {
  token: string | null
  user: User | null
  workspace: Workspace | null
  workspaces: Workspace[]
  isAuthenticated: boolean
  _hasHydrated: boolean
  setHasHydrated: (hydrated: boolean) => void
  login: (payload: { accessToken: string; user: User; workspace: Workspace; workspaces?: Workspace[] }) => void
  switchWorkspace: (workspace: Workspace) => void
  logout: () => void
  updateUser: (user: Partial<User>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      workspace: null,
      workspaces: [],
      isAuthenticated: false,
      _hasHydrated: false,

      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),

      login: ({ accessToken, user, workspace, workspaces }) => {
        set({
          token: accessToken,
          user,
          workspace,
          workspaces: workspaces ?? [workspace],
          isAuthenticated: true,
        })
      },

      switchWorkspace: (workspace) => {
        queryClient.clear()
        set({ workspace })
      },

      logout: () => {
        queryClient.clear()
        set({ token: null, user: null, workspace: null, workspaces: [], isAuthenticated: false })
      },

      updateUser: (userData) => {
        set((state) => ({ user: state.user ? { ...state.user, ...userData } : null }))
      },
    }),
    {
      name: 'paid-in-full-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        workspace: state.workspace,
        workspaces: state.workspaces,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)
