import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import type { CurrentUserData } from '../../../common/decorators/current-user.decorator';
import { PlatformRoleName, Role } from '../../../common/decorators/roles.decorator';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  workspaceId: string;
  /** Workspace role at sign-in time (informational; the DB is re-read on every request). */
  role?: string | null;
  isBiller?: boolean;
  /** Legacy `[role]`. */
  roles: string[];
}

type ValidatedUser = CurrentUserData;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  // Runs on every authenticated request app-wide — a short cache trades a few seconds of
  // staleness on deactivation/role changes for skipping a DB round trip on nearly every request.
  private static readonly CACHE_TTL_MS = 10_000;
  private cache = new Map<string, { user: ValidatedUser | null; expiresAt: number }>();

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') || 'fallback-secret',
    });
  }

  private cacheKey(userId: string, workspaceId: string) {
    return `${userId}:${workspaceId}`;
  }

  private async getValidatedUser(userId: string, workspaceId: string): Promise<ValidatedUser | null> {
    const key = this.cacheKey(userId, workspaceId);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }

    const [row, membership] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          displayName: true,
          isActive: true,
          platformRole: true,
        },
      }),
      this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true, isBiller: true, isActive: true },
      }),
    ]);

    const isPlatformAdmin = row?.platformRole === 'SUPER_ADMIN';
    // PIF staff (SUPER_ADMIN, CLIENT_SETUP) may hold a token without a workspace membership; their
    // workspace capabilities are then empty and only platform-guarded routes work.
    const isPlatformStaff = !!row?.platformRole;
    const activeMembership = membership && membership.isActive ? membership : null;

    const user: ValidatedUser | null =
      row && row.isActive && (isPlatformStaff || activeMembership)
        ? {
            id: row.id,
            email: row.email,
            workspaceId,
            role: activeMembership ? (activeMembership.role as Role) : null,
            isBiller: activeMembership?.isBiller ?? false,
            roles: activeMembership ? [activeMembership.role] : [],
            firstName: row.firstName,
            lastName: row.lastName,
            displayName: row.displayName || `${row.firstName} ${row.lastName}`.trim(),
            platformRole: (row.platformRole as PlatformRoleName | null) ?? null,
            isPlatformAdmin,
          }
        : null;

    this.cache.set(key, { user, expiresAt: Date.now() + JwtStrategy.CACHE_TTL_MS });
    return user;
  }

  async validate(payload: JwtPayload) {
    const user = await this.getValidatedUser(payload.sub, payload.workspaceId);
    if (!user) {
      throw new UnauthorizedException('User not found, inactive, or no longer a member of this workspace');
    }
    return user;
  }
}
