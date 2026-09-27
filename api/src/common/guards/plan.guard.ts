import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { REQUIRES_PLAN_KEY } from '../decorators/plan.decorator';

// Matches the marketing site's three tiers (Starter / Growth / Enterprise).
const PLAN_HIERARCHY: Record<string, number> = { STARTER: 0, GROWTH: 1, ENTERPRISE: 2 };

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPlans = this.reflector.getAllAndOverride<string[]>(REQUIRES_PLAN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPlans || requiredPlans.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('User not found');
    }

    // Platform admins bypass all plan checks
    if (user.isPlatformAdmin) {
      return true;
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: user.workspaceId },
      select: {
        planTier: true,
        subscriptionStatus: true,
        trialEndDate: true,
        subscriptionEndDate: true,
        isGrandfathered: true,
      },
    });

    if (!workspace) {
      throw new ForbiddenException('Workspace not found');
    }

    // Grandfathered workspaces bypass all checks
    if (workspace.isGrandfathered) {
      return true;
    }

    // Compute effective plan
    let effectivePlan: string = workspace.planTier;
    const now = new Date();

    if (workspace.subscriptionStatus === 'TRIALING' && workspace.trialEndDate && now > workspace.trialEndDate) {
      effectivePlan = 'STARTER';
    }
    if (workspace.subscriptionStatus === 'EXPIRED') {
      effectivePlan = 'STARTER';
    }
    if (workspace.subscriptionStatus === 'CANCELLED') {
      // Keep current plan if subscription end date hasn't passed yet
      if (workspace.subscriptionEndDate && now > workspace.subscriptionEndDate) {
        effectivePlan = 'STARTER';
      }
    }

    const effectiveLevel = PLAN_HIERARCHY[effectivePlan] ?? 0;
    const minRequired = Math.min(...requiredPlans.map((p) => PLAN_HIERARCHY[p] ?? 0));

    if (effectiveLevel < minRequired) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PLAN_UPGRADE_REQUIRED',
        requiredPlan: requiredPlans[0],
        currentPlan: effectivePlan,
        message: `This feature requires a ${requiredPlans[0]} plan or higher`,
      });
    }

    return true;
  }
}
