import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { PlatformRoleName, Role } from './roles.decorator';

/**
 * request.user, populated by JwtStrategy from the DB (10s cache) on every authenticated request.
 * `role` / `isBiller` are for the ACTIVE workspace (`workspaceId`, from the JWT).
 */
export interface CurrentUserData {
  id: string;
  email: string;
  workspaceId: string;
  /** Effective workspace role, or null for a super admin who isn't a member of this workspace. */
  role: Role | null;
  /** Biller add-on flag for the active workspace. */
  isBiller: boolean;
  /** Legacy: `[role]` (empty when role is null). Prefer `role`. */
  roles: string[];
  firstName: string;
  lastName: string;
  displayName: string;
  platformRole: PlatformRoleName | null;
  /** platformRole === SUPER_ADMIN. */
  isPlatformAdmin: boolean;
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as CurrentUserData;

    if (data) {
      return user?.[data];
    }

    return user;
  },
);
