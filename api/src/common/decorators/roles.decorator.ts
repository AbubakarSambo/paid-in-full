import { SetMetadata } from '@nestjs/common';

/**
 * Workspace roles (one primary role per member). Values mirror the Prisma `WorkspaceRole` enum.
 * Biller is NOT a role: it's the `isBiller` add-on flag on WorkspaceMember.
 * Platform roles (SUPER_ADMIN, CLIENT_SETUP) live on User.platformRole; see PlatformRoleName.
 */
export enum Role {
  VIEWER = 'VIEWER',
  REQUESTER = 'REQUESTER',
  PROCUREMENT = 'PROCUREMENT',
  POSTER = 'POSTER',
  APPROVER = 'APPROVER',
  PAYER = 'PAYER',
  ADMIN = 'ADMIN',
}

/** Platform (PIF staff) roles. Values mirror the Prisma `PlatformRole` enum. */
export enum PlatformRoleName {
  SUPER_ADMIN = 'SUPER_ADMIN',
  CLIENT_SETUP = 'CLIENT_SETUP',
}

export const ROLES_KEY = 'roles';

/**
 * Exact-match role check (the member's role must be one of those listed). Platform SUPER_ADMIN
 * always passes. Prefer @RequireCapability for anything that follows the spec's hierarchy.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
