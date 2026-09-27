import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  workspaceId: string;
  roles: string[];
}

interface ValidatedUser {
  id: string;
  email: string;
  workspaceId: string;
  roles: string[];
  firstName: string;
  lastName: string;
  isPlatformAdmin: boolean;
}

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
        select: { id: true, email: true, firstName: true, lastName: true, isActive: true, isPlatformAdmin: true },
      }),
      this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true, isActive: true },
      }),
    ]);

    const user =
      row && row.isActive && (row.isPlatformAdmin || (membership && membership.isActive))
        ? {
            id: row.id,
            email: row.email,
            workspaceId,
            roles: membership ? [membership.role] : [],
            firstName: row.firstName,
            lastName: row.lastName,
            isPlatformAdmin: row.isPlatformAdmin,
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
