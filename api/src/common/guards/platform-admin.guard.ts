import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { isSuperAdmin } from '../permissions';

/** Platform SUPER_ADMIN only. For client_setup staff use @RequireCapability(Capability.CLIENT_SETUP). */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();

    if (!isSuperAdmin(user)) {
      throw new ForbiddenException('Platform admin access required');
    }

    return true;
  }
}
