import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { CAPABILITIES_KEY } from '../decorators/require-capability.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import { Capability, CAPABILITY_LABEL, hasCapability, isRole } from '../permissions';

/**
 * Global guard (APP_GUARD, runs after JwtAuthGuard). No-ops unless the route/controller has
 * @RequireCapability(...). Uses the role + biller flag JwtStrategy resolved for the active
 * workspace; if they're missing (e.g. a custom auth path), it re-reads the membership row.
 * Platform super admins pass every check.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Capability[] | undefined>(CAPABILITIES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as CurrentUserData | undefined;
    if (!user) throw new ForbiddenException('Not authenticated');

    if (!user.isPlatformAdmin && !isRole(user.role) && user.workspaceId) {
      const membership = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: user.workspaceId, userId: user.id } },
        select: { role: true, isBiller: true, isActive: true },
      });
      if (membership?.isActive) {
        user.role = membership.role as CurrentUserData['role'];
        user.isBiller = membership.isBiller;
        user.roles = [membership.role];
      }
    }

    if (required.some((cap) => hasCapability(user, cap))) return true;

    throw new ForbiddenException(required.map((cap) => CAPABILITY_LABEL[cap]).join(' or '));
  }
}
