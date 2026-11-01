import { useAuthStore } from '@/stores/authStore'

/**
 * Spec §3 role model, mirrored from api/src/common/permissions.ts. The server enforces all of this;
 * the client only hides/disables controls.
 * Precedence: ADMIN > PAYER > APPROVER > POSTER > PROCUREMENT > REQUESTER > VIEWER (each includes those below).
 */
export const ROLE_ORDER = ['VIEWER', 'REQUESTER', 'PROCUREMENT', 'POSTER', 'APPROVER', 'PAYER', 'ADMIN'] as const
export type WorkspaceRole = (typeof ROLE_ORDER)[number]

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  VIEWER: 'Viewer',
  REQUESTER: 'Requester',
  PROCUREMENT: 'Procurement',
  POSTER: 'Poster',
  APPROVER: 'Approver',
  PAYER: 'Payer',
  ADMIN: 'Admin',
}

/** Spec §3 badge colours: admin gold, approver green, payer purple, poster blue, procurement light-blue, others grey. */
export const ROLE_BADGE_CLASS: Record<WorkspaceRole, string> = {
  ADMIN: 'bg-gold/15 text-gold border-gold/30',
  APPROVER: 'bg-green/15 text-green border-green/30',
  PAYER: 'bg-purple/15 text-purple border-purple/30',
  POSTER: 'bg-blue/15 text-blue border-blue/30',
  PROCUREMENT: 'bg-sky-400/15 text-sky-400 border-sky-400/30',
  REQUESTER: 'bg-surface3 text-text-dim border-border',
  VIEWER: 'bg-surface3 text-text-dim border-border',
}

const rank = (role?: string | null) => (role ? ROLE_ORDER.indexOf(role.toUpperCase() as WorkspaceRole) : -1)
const atLeast = (role: string | null | undefined, min: WorkspaceRole) => rank(role) >= ROLE_ORDER.indexOf(min)

export const isAdmin = (role?: string | null) => atLeast(role, 'ADMIN')
export const canPay = (role?: string | null) => atLeast(role, 'PAYER')
export const canApprove = (role?: string | null) => atLeast(role, 'APPROVER')
export const canPost = (role?: string | null) => atLeast(role, 'POSTER')
export const canProcure = (role?: string | null) => atLeast(role, 'PROCUREMENT')
export const canRequest = (role?: string | null) => atLeast(role, 'REQUESTER')
export const canView = (role?: string | null) => rank(role) >= 0
export const canInvoice = (role?: string | null, isBiller?: boolean) => !!isBiller || isAdmin(role)

export type Capability = 'view' | 'request' | 'procure' | 'post' | 'approve' | 'pay' | 'admin' | 'invoice' | 'superAdmin' | 'clientSetup'

export interface Capabilities {
  role: string | null
  isBiller: boolean
  platformRole: string | null
  canView: boolean
  canRequest: boolean
  canProcure: boolean
  canPost: boolean
  canApprove: boolean
  canPay: boolean
  isAdmin: boolean
  canInvoice: boolean
  isSuperAdmin: boolean
  isClientSetup: boolean
  /** SUPER_ADMIN or CLIENT_SETUP. */
  isPlatformStaff: boolean
}

/** Pure capability resolver. Platform SUPER_ADMIN passes every workspace check (as on the server). */
export function capabilitiesFor(role: string | null | undefined, isBiller = false, platformRole: string | null = null): Capabilities {
  const sa = platformRole === 'SUPER_ADMIN'
  const r = role ?? null
  return {
    role: r,
    isBiller,
    platformRole,
    canView: sa || canView(r),
    canRequest: sa || canRequest(r),
    canProcure: sa || canProcure(r),
    canPost: sa || canPost(r),
    canApprove: sa || canApprove(r),
    canPay: sa || canPay(r),
    isAdmin: sa || isAdmin(r),
    canInvoice: sa || canInvoice(r, isBiller),
    isSuperAdmin: sa,
    isClientSetup: platformRole === 'CLIENT_SETUP',
    isPlatformStaff: sa || platformRole === 'CLIENT_SETUP',
  }
}

/** Current member's role and biller flag. */
export function useRole(): { role: string | null; isBiller: boolean } {
  const role = useAuthStore((s) => s.role ?? (s.workspace?.role as string | null | undefined) ?? (s.user?.role as string | null | undefined) ?? null)
  const isBiller = useAuthStore((s) => s.isBiller || !!s.workspace?.isBiller)
  return { role, isBiller }
}

/** All capabilities of the signed-in user in the current workspace. */
export function usePermissions(): Capabilities {
  const { role, isBiller } = useRole()
  const platformRole = useAuthStore((s) => s.platformRole ?? (s.user?.platformRole as string | null | undefined) ?? null)
  return capabilitiesFor(role, isBiller, platformRole)
}

/**
 * `const can = useCan(); can('post')` — or `useCan('approve')` for a single boolean.
 */
export function useCan(): (cap: Capability) => boolean
export function useCan(cap: Capability): boolean
export function useCan(cap?: Capability): boolean | ((cap: Capability) => boolean) {
  const c = usePermissions()
  const check = (k: Capability) =>
    ({
      view: c.canView,
      request: c.canRequest,
      procure: c.canProcure,
      post: c.canPost,
      approve: c.canApprove,
      pay: c.canPay,
      admin: c.isAdmin,
      invoice: c.canInvoice,
      superAdmin: c.isSuperAdmin,
      clientSetup: c.isPlatformStaff,
    })[k]
  return cap ? check(cap) : check
}

/** Spec §3 read-only copy, e.g. readOnlyCopy('Poster') → "Read-only — Poster role required to edit". */
export const readOnlyCopy = (roleLabel: string) => `Read-only — ${roleLabel} role required to edit`
