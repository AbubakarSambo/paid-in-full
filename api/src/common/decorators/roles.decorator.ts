import { SetMetadata } from '@nestjs/common';

// Matches gold-batch-pro's marketing copy ("Poster, Approver, Admin") plus a platform-wide
// SUPER_ADMIN used only by PlatformAdminGuard, not by workspace-scoped RolesGuard checks.
export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  APPROVER = 'APPROVER',
  POSTER = 'POSTER',
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
