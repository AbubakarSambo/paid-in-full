import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

interface WorkspaceSubscriptionFields {
  subscriptionStatus: string;
  trialEndDate: Date | null;
  isGrandfathered: boolean;
}

@Injectable()
export class SubscriptionReadOnlyGuard implements CanActivate {
  // Registered as an APP_GUARD, so it runs on every non-GET request app-wide — cache the
  // subscription lookup briefly rather than round-tripping the DB on every mutating request.
  private static readonly CACHE_TTL_MS = 30_000;
  private cache = new Map<string, { workspace: WorkspaceSubscriptionFields; expiresAt: number }>();

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  private async getWorkspaceSubscriptionFields(workspaceId: string): Promise<WorkspaceSubscriptionFields | null> {
    const cached = this.cache.get(workspaceId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.workspace;
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        subscriptionStatus: true,
        trialEndDate: true,
        isGrandfathered: true,
      },
    });
    if (workspace) {
      this.cache.set(workspaceId, { workspace, expiresAt: Date.now() + SubscriptionReadOnlyGuard.CACHE_TTL_MS });
    }
    return workspace;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const { user, method, url } = request;

    if (!user || ['GET', 'OPTIONS', 'HEAD'].includes(method)) {
      return true;
    }

    if (user.isPlatformAdmin) {
      return true;
    }

    // Whitelist path segments related to auth, subscription upgrading, and payment/payout hooks —
    // an expired workspace still needs to be able to pay its own bill or receive Monnify callbacks.
    const isAllowedWriteRoute =
      url.includes('/auth/') ||
      url.includes('/billing/') ||
      url.includes('/monnify/') ||
      url.includes('/hooks/');

    if (isAllowedWriteRoute) {
      return true;
    }

    const workspace = await this.getWorkspaceSubscriptionFields(user.workspaceId);

    if (!workspace) {
      throw new ForbiddenException('Workspace not found');
    }

    if (workspace.isGrandfathered) {
      return true;
    }

    const now = new Date();
    const isExpired =
      workspace.subscriptionStatus === 'EXPIRED' ||
      (workspace.subscriptionStatus === 'TRIALING' && workspace.trialEndDate && now > workspace.trialEndDate);

    if (isExpired) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'SUBSCRIPTION_EXPIRED_READ_ONLY',
        message: 'Your subscription has expired. The system is in read-only mode. Please renew to queue, approve, or disburse payments.',
      });
    }

    return true;
  }
}
