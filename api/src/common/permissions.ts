import { PlatformRoleName, Role } from './decorators/roles.decorator';

/**
 * Spec §3 role model. One primary role per member, resolved by precedence
 * ADMIN > PAYER > APPROVER > POSTER > PROCUREMENT > REQUESTER > VIEWER, plus the Biller add-on.
 *
 * Capabilities are hierarchical: a role can do everything the roles below it can
 * (e.g. an approver can post, a payer can approve). Biller is orthogonal: canInvoice = biller OR admin.
 * Platform SUPER_ADMIN passes every capability check; CLIENT_SETUP only grants Capability.CLIENT_SETUP.
 */
export const ROLE_PRECEDENCE: Role[] = [
  Role.ADMIN,
  Role.PAYER,
  Role.APPROVER,
  Role.POSTER,
  Role.PROCUREMENT,
  Role.REQUESTER,
  Role.VIEWER,
];

const ROLE_RANK: Record<Role, number> = {
  [Role.VIEWER]: 0,
  [Role.REQUESTER]: 1,
  [Role.PROCUREMENT]: 2,
  [Role.POSTER]: 3,
  [Role.APPROVER]: 4,
  [Role.PAYER]: 5,
  [Role.ADMIN]: 6,
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && value in ROLE_RANK;
}

export function roleRank(role: Role | string | null | undefined): number {
  return isRole(role) ? ROLE_RANK[role] : -1;
}

/** Highest-precedence role out of several (e.g. legacy multi-row roles). Null if none valid. */
export function effectiveRole(roles: Array<Role | string | null | undefined>): Role | null {
  let best: Role | null = null;
  for (const r of roles) {
    if (isRole(r) && (best === null || ROLE_RANK[r] > ROLE_RANK[best])) best = r;
  }
  return best;
}

/** Minimal shape the helpers need; CurrentUserData satisfies it. */
export interface PermissionSubject {
  role?: Role | string | null;
  isBiller?: boolean;
  isPlatformAdmin?: boolean;
  platformRole?: PlatformRoleName | string | null;
}

function atLeast(subject: PermissionSubject | null | undefined, min: Role): boolean {
  if (!subject) return false;
  if (subject.isPlatformAdmin) return true;
  return roleRank(subject.role) >= ROLE_RANK[min];
}

/** Any active member (or super admin) can read. */
export const canView = (s: PermissionSubject | null | undefined) => !!s && (!!s.isPlatformAdmin || isRole(s.role));
/** Raise / edit own requisitions. */
export const canRequest = (s: PermissionSubject | null | undefined) => atLeast(s, Role.REQUESTER);
/** Clear / return / reject requisitions. */
export const canProcure = (s: PermissionSubject | null | undefined) => atLeast(s, Role.PROCUREMENT);
/** Create/edit queue items, bundles, CSV, quick add, comments; push requisitions to queue. */
export const canPost = (s: PermissionSubject | null | undefined) => atLeast(s, Role.POSTER);
/** Approve queue items into batches, reject, split, reclassify batch lines, set WHT. */
export const canApprove = (s: PermissionSubject | null | undefined) => atLeast(s, Role.APPROVER);
/** Disburse batches, retry failed lines (also needs a personal PIN). */
export const canPay = (s: PermissionSubject | null | undefined) => atLeast(s, Role.PAYER);
/** Users, settings, modules, wallet, WHT account, delete batches. */
export const isAdmin = (s: PermissionSubject | null | undefined) => atLeast(s, Role.ADMIN);
/** Invoices module: Biller add-on or admin. */
export const canInvoice = (s: PermissionSubject | null | undefined) => !!s && (!!s.isBiller || isAdmin(s));
/** PIF staff: super-admin console. */
export const isSuperAdmin = (s: PermissionSubject | null | undefined) =>
  !!s && (!!s.isPlatformAdmin || s.platformRole === PlatformRoleName.SUPER_ADMIN);
/** PIF staff who can create client workspaces (no money figures). */
export const canClientSetup = (s: PermissionSubject | null | undefined) =>
  isSuperAdmin(s) || s?.platformRole === PlatformRoleName.CLIENT_SETUP;

export enum Capability {
  VIEW = 'view',
  REQUEST = 'request',
  PROCURE = 'procure',
  POST = 'post',
  APPROVE = 'approve',
  PAY = 'pay',
  ADMIN = 'admin',
  INVOICE = 'invoice',
  SUPER_ADMIN = 'super_admin',
  CLIENT_SETUP = 'client_setup',
}

const CAPABILITY_CHECKS: Record<Capability, (s: PermissionSubject | null | undefined) => boolean> = {
  [Capability.VIEW]: canView,
  [Capability.REQUEST]: canRequest,
  [Capability.PROCURE]: canProcure,
  [Capability.POST]: canPost,
  [Capability.APPROVE]: canApprove,
  [Capability.PAY]: canPay,
  [Capability.ADMIN]: isAdmin,
  [Capability.INVOICE]: canInvoice,
  [Capability.SUPER_ADMIN]: isSuperAdmin,
  [Capability.CLIENT_SETUP]: canClientSetup,
};

export function hasCapability(subject: PermissionSubject | null | undefined, capability: Capability): boolean {
  return CAPABILITY_CHECKS[capability](subject);
}

/** Human-readable copy used in 403s, matching the app's "Poster role required" style. */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  [Capability.VIEW]: 'Workspace membership required',
  [Capability.REQUEST]: 'Requester role required',
  [Capability.PROCURE]: 'Procurement role required',
  [Capability.POST]: 'Poster role required',
  [Capability.APPROVE]: 'Approver role required',
  [Capability.PAY]: 'Payer role required',
  [Capability.ADMIN]: 'Admin role required',
  [Capability.INVOICE]: 'Biller access required',
  [Capability.SUPER_ADMIN]: 'Platform admin access required',
  [Capability.CLIENT_SETUP]: 'Client setup access required',
};
