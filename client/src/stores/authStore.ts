import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { queryClient } from '@/lib/queryClient'
import type { PlatformRoleName, Session, SessionUser, SessionWorkspace, WorkspaceRoleName } from '@/types/shell'

// Index signatures keep older pages that read ad-hoc fields compiling.
export type StoreUser = SessionUser & { [key: string]: unknown }
export type StoreWorkspace = SessionWorkspace & { [key: string]: unknown }

interface SessionLike {
  accessToken: string
  user: SessionUser | StoreUser
  workspace: SessionWorkspace | StoreWorkspace | null
  workspaces?: Array<SessionWorkspace | StoreWorkspace>
  needsOnboarding?: boolean
}

interface AuthState {
  token: string | null
  user: StoreUser | null
  workspace: StoreWorkspace | null
  workspaces: StoreWorkspace[]
  /** Effective workspace role (spec §3), from the current membership. */
  role: WorkspaceRoleName | null
  isBiller: boolean
  platformRole: PlatformRoleName | null
  needsOnboarding: boolean
  isAuthenticated: boolean
  _hasHydrated: boolean
  setHasHydrated: (hydrated: boolean) => void
  /** Store a full session payload (login, register, set-password, switch, refresh). */
  setSession: (session: SessionLike | Session) => void
  /** Alias of setSession kept for older callers. */
  login: (session: SessionLike | Session) => void
  /** Swap to another workspace's session (POST /auth/switch-workspace returns one). Clears cached queries. */
  switchWorkspace: (session: SessionLike | Session) => void
  logout: () => void
  updateUser: (user: Partial<SessionUser>) => void
  updateWorkspace: (workspace: Partial<SessionWorkspace>) => void
  setNeedsOnboarding: (v: boolean) => void
}

function fromSession(s: SessionLike) {
  const workspace = (s.workspace as StoreWorkspace | null) ?? null
  const user = s.user as StoreUser
  return {
    token: s.accessToken,
    user,
    workspace,
    workspaces: (s.workspaces ?? (workspace ? [workspace] : [])) as StoreWorkspace[],
    role: (workspace?.role ?? user.role ?? null) as WorkspaceRoleName | null,
    isBiller: !!(workspace?.isBiller ?? user.isBiller),
    platformRole: (user.platformRole ?? null) as PlatformRoleName | null,
    needsOnboarding: !!s.needsOnboarding,
    isAuthenticated: true,
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      workspace: null,
      workspaces: [],
      role: null,
      isBiller: false,
      platformRole: null,
      needsOnboarding: false,
      isAuthenticated: false,
      _hasHydrated: false,

      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),

      setSession: (session) => set(fromSession(session)),
      login: (session) => set(fromSession(session)),

      switchWorkspace: (session) => {
        queryClient.clear()
        set(fromSession(session))
      },

      logout: () => {
        queryClient.clear()
        set({
          token: null,
          user: null,
          workspace: null,
          workspaces: [],
          role: null,
          isBiller: false,
          platformRole: null,
          needsOnboarding: false,
          isAuthenticated: false,
        })
      },

      updateUser: (userData) => set((state) => ({ user: state.user ? { ...state.user, ...userData } : null })),

      updateWorkspace: (ws) =>
        set((state) => {
          if (!state.workspace) return {}
          const workspace = { ...state.workspace, ...ws }
          return { workspace, workspaces: state.workspaces.map((w) => (w.id === workspace.id ? { ...w, ...ws } : w)) }
        }),

      setNeedsOnboarding: (v) => set({ needsOnboarding: v }),
    }),
    {
      name: 'paid-in-full-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        workspace: state.workspace,
        workspaces: state.workspaces,
        role: state.role,
        isBiller: state.isBiller,
        platformRole: state.platformRole,
        needsOnboarding: state.needsOnboarding,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)
