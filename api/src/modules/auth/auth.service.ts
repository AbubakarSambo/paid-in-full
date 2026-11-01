import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { Role } from '../../common/decorators/roles.decorator';
import { createWorkspaceRecord } from '../workspaces/workspace-factory';
import { RegisterDto, LoginDto, GoogleSignInDto, SetPasswordDto } from './dto';
import { normalizeGmail, verifyGoogleIdToken } from './google-id-token';

export type AuthTokenType = 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'INVITE';

const TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  EMAIL_VERIFY: 3 * 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 60 * 60 * 1000,
  INVITE: 7 * 24 * 60 * 60 * 1000,
};

const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_LOCK_MINUTES = 15;

function friendly(message: string, code: string) {
  return { message, errors: { code } };
}

export function splitName(name?: string | null): { firstName: string; lastName: string } {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function hashToken(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private email: EmailService,
  ) {}

  // ─── Tokens & sessions ────────────────────────────────────────────────────

  private signToken(payload: { sub: string; email: string; workspaceId: string; role: string | null; isBiller: boolean }) {
    return this.jwt.sign(
      { ...payload, roles: payload.role ? [payload.role] : [] },
      {
        secret: this.config.get<string>('jwt.secret') || 'fallback-secret',
        expiresIn: (this.config.get<string>('jwt.expiresIn') || '7d') as any,
      },
    );
  }

  private findUserByEmail(email: string) {
    return this.prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } });
  }

  /**
   * Issues a single-use emailed token (only the sha256 is stored). Earlier unused tokens of the same
   * type (and workspace, for invites) are revoked so only the latest link works.
   */
  async createAuthToken(userId: string, type: AuthTokenType, workspaceId?: string | null, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const raw = randomBytes(32).toString('hex');
    await client.emailVerificationToken.updateMany({
      where: { userId, type, usedAt: null, ...(type === 'INVITE' ? { workspaceId: workspaceId ?? null } : {}) },
      data: { usedAt: new Date() },
    });
    await client.emailVerificationToken.create({
      data: { userId, type, token: hashToken(raw), workspaceId: workspaceId ?? null, expiresAt: new Date(Date.now() + TOKEN_TTL_MS[type]) },
    });
    return raw;
  }

  private async findLiveToken(raw: string, types: AuthTokenType[]) {
    const row = await this.prisma.emailVerificationToken.findUnique({ where: { token: hashToken(raw || '') } });
    if (!row || !types.includes(row.type as AuthTokenType) || row.usedAt) {
      throw new BadRequestException(friendly('This link is invalid or has already been used. Ask for a new one.', 'TOKEN_INVALID'));
    }
    if (row.expiresAt < new Date()) {
      throw new BadRequestException(friendly('This link has expired. Ask for a new one.', 'TOKEN_EXPIRED'));
    }
    return row;
  }

  /** Full session payload for the SPA. Picks `workspaceId` if given, else the first joined workspace. */
  async buildSession(userId: string, workspaceId?: string | null, opts: { allowNonMember?: boolean } = {}) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { security: { select: { pinHash: true } } } });
    if (!user) throw new NotFoundException('User not found');

    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, isActive: true },
      include: { workspace: { select: { id: true, name: true, slug: true, logoUrl: true, status: true } } },
      orderBy: [{ joinedAt: { sort: 'asc', nulls: 'last' } }, { invitedAt: 'asc' }],
    });

    let current = workspaceId ? memberships.find((m) => m.workspaceId === workspaceId) : memberships[0];
    let workspace: { id: string; name: string; slug: string; logoUrl: string | null; status: string } | null = current?.workspace ?? null;

    if (workspaceId && !current) {
      if (!opts.allowNonMember) throw new ForbiddenException('You are not a member of this workspace.');
      workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, name: true, slug: true, logoUrl: true, status: true },
      });
      if (!workspace) throw new NotFoundException('Workspace not found');
    }

    if (!workspace && !user.platformRole) {
      throw new UnauthorizedException(friendly("This account isn't part of any workspace yet. Ask an admin to invite you, or create a workspace.", 'NO_WORKSPACE'));
    }

    // Entering a workspace you were invited to accepts the invite.
    if (current && !current.joinedAt) {
      await this.prisma.workspaceMember.update({ where: { id: current.id }, data: { joinedAt: new Date() } });
      current = { ...current, joinedAt: new Date() };
    }

    const role = (current?.role as Role | undefined) ?? null;
    const isBiller = current?.isBiller ?? false;
    const wizardDone = workspace
      ? await this.prisma.appConfig.findUnique({ where: { workspaceId_key: { workspaceId: workspace.id, key: 'setup_wizard_done' } } })
      : null;
    const accessToken = this.signToken({ sub: user.id, email: user.email, workspaceId: workspace?.id ?? '', role, isBiller });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: user.displayName || `${user.firstName} ${user.lastName}`.trim() || user.email,
        avatarUrl: user.avatarUrl,
        accentSkin: user.accentSkin,
        onboarded: user.onboarded,
        isEmailVerified: user.isEmailVerified,
        hasPassword: user.hasPassword,
        hasPin: !!user.security?.pinHash,
        platformRole: user.platformRole,
        isPlatformAdmin: user.platformRole === 'SUPER_ADMIN',
        role,
        isBiller,
      },
      workspace: workspace ? { ...workspace, role, isBiller } : null,
      workspaces: memberships.map((m) => ({ ...m.workspace, role: m.role, isBiller: m.isBiller, invited: !m.joinedAt })),
      /** Admin of a workspace whose onboarding wizard hasn't been completed (spec §2 /onboarding). */
      needsOnboarding: role === Role.ADMIN && wizardDone?.value === false,
    };
  }

  // ─── Register / login ─────────────────────────────────────────────────────

  /** Creates the workspace + its first user, who is ADMIN of it. Sends a confirmation email. */
  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.findUserByEmail(email);
    if (existing) {
      throw new ConflictException(
        friendly(
          existing.hasPassword
            ? 'An account with this email already exists. Sign in instead, or use "Forgot password".'
            : 'This email already has an account (Google sign-in or a pending invite). Use "Continue with Google" or your invite link.',
          'EMAIL_TAKEN',
        ),
      );
    }

    const names = dto.name ? splitName(dto.name) : { firstName: dto.firstName?.trim() || '', lastName: dto.lastName?.trim() || '' };
    if (!names.firstName) throw new BadRequestException('Enter your name.');
    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.$transaction(async (tx) => {
      const workspace = await createWorkspaceRecord(tx, { name: dto.workspaceName });
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName: names.firstName,
          lastName: names.lastName,
          displayName: `${names.firstName} ${names.lastName}`.trim(),
        },
      });
      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: created.id, role: Role.ADMIN, joinedAt: new Date() },
      });
      return created;
    });

    await this.sendConfirmation(user.id, user.email, user.firstName);
    return this.buildSession(user.id);
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.findUserByEmail(email);

    if (!user) {
      const norm = normalizeGmail(email);
      if (norm) {
        const candidates = await this.prisma.user.findMany({
          where: { OR: [{ email: { endsWith: '@gmail.com', mode: 'insensitive' } }, { email: { endsWith: '@googlemail.com', mode: 'insensitive' } }] },
          select: { email: true },
        });
        const match = candidates.find((c) => normalizeGmail(c.email) === norm);
        if (match) {
          throw new UnauthorizedException(
            friendly(`No account uses ${email}, but ${match.email} does — Gmail treats dots as the same address. Sign in with ${match.email}.`, 'GMAIL_VARIANT'),
          );
        }
      }
      throw new UnauthorizedException(friendly('Wrong email or password. Check both and try again.', 'BAD_CREDENTIALS'));
    }

    const sec = await this.prisma.userSecurity.findUnique({ where: { userId: user.id } });
    if (sec?.lockedUntil && sec.lockedUntil > new Date()) {
      const mins = Math.ceil((sec.lockedUntil.getTime() - Date.now()) / 60000);
      throw new UnauthorizedException(
        friendly(`Too many sign-in attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or reset your password.`, 'RATE_LIMITED'),
      );
    }

    if (!user.isActive && !user.hasPassword) {
      throw new UnauthorizedException(
        friendly("You've been invited but haven't set a password yet. Use the link in your invite email, or ask an admin to resend it.", 'INVITE_PENDING'),
      );
    }
    if (!user.isActive) throw new UnauthorizedException(friendly('This account has been deactivated. Contact your workspace admin.', 'DEACTIVATED'));

    if (!user.hasPassword) {
      throw new UnauthorizedException(
        friendly('This account signs in with Google. Use "Continue with Google", or reset your password to add one.', 'GOOGLE_ACCOUNT'),
      );
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      const attempts = (sec?.failedLoginAttempts ?? 0) + 1;
      const lock = attempts >= MAX_LOGIN_ATTEMPTS;
      await this.prisma.userSecurity.upsert({
        where: { userId: user.id },
        create: { userId: user.id, failedLoginAttempts: lock ? 0 : attempts, lockedUntil: lock ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60000) : null },
        update: { failedLoginAttempts: lock ? 0 : attempts, lockedUntil: lock ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60000) : null },
      });
      if (lock) {
        throw new UnauthorizedException(friendly(`Too many sign-in attempts. Try again in ${LOGIN_LOCK_MINUTES} minutes, or reset your password.`, 'RATE_LIMITED'));
      }
      throw new UnauthorizedException(
        friendly(
          user.googleSub
            ? 'Wrong password. This account is also linked to Google — try "Continue with Google".'
            : 'Wrong email or password. Check both and try again.',
          'BAD_CREDENTIALS',
        ),
      );
    }

    await this.prisma.userSecurity.upsert({
      where: { userId: user.id },
      create: { userId: user.id, lastLoginAt: new Date() },
      update: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    return this.buildSession(user.id);
  }

  /** "Continue with Google": verify the ID token, then sign in (or sign up when workspaceName is given). */
  async googleSignIn(dto: GoogleSignInDto) {
    const identity = await verifyGoogleIdToken(dto.idToken, this.config.get<string>('google.clientId'));
    if (!identity.emailVerified) throw new UnauthorizedException('Your Google email is not verified with Google.');

    let user =
      (await this.prisma.user.findFirst({ where: { googleSub: identity.sub } })) ?? (await this.findUserByEmail(identity.email));

    if (!user) {
      if (!dto.workspaceName) {
        throw new NotFoundException(
          friendly(`No Paid in Full account uses ${identity.email}. Create a workspace first, or sign in with the email you were invited with.`, 'NO_ACCOUNT'),
        );
      }
      const names = identity.givenName ? { firstName: identity.givenName, lastName: identity.familyName || '' } : splitName(identity.name);
      user = await this.prisma.$transaction(async (tx) => {
        const workspace = await createWorkspaceRecord(tx, { name: dto.workspaceName! });
        const created = await tx.user.create({
          data: {
            email: identity.email,
            passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 10),
            hasPassword: false,
            googleSub: identity.sub,
            isEmailVerified: true,
            firstName: names.firstName || identity.email.split('@')[0],
            lastName: names.lastName,
            displayName: identity.name || undefined,
            avatarUrl: identity.picture || undefined,
          },
        });
        await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId: created.id, role: Role.ADMIN, joinedAt: new Date() } });
        return created;
      });
      return this.buildSession(user.id);
    }

    if (user.googleSub && user.googleSub !== identity.sub) {
      throw new UnauthorizedException('This email is linked to a different Google account.');
    }

    // Link Google; an invited (inactive) user is activated by proving the email via Google.
    const pendingNames = !user.firstName && identity.givenName ? { firstName: identity.givenName, lastName: identity.familyName || '' } : {};
    user = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        googleSub: identity.sub,
        isEmailVerified: true,
        isActive: true,
        avatarUrl: user.avatarUrl ?? identity.picture ?? undefined,
        ...pendingNames,
      },
    });
    await this.prisma.emailVerificationToken.updateMany({ where: { userId: user.id, type: 'INVITE', usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.userSecurity.upsert({
      where: { userId: user.id },
      create: { userId: user.id, lastLoginAt: new Date() },
      update: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
    });
    return this.buildSession(user.id);
  }

  // ─── Email confirmation / password reset / invites ────────────────────────

  private async sendConfirmation(userId: string, email: string, firstName?: string) {
    try {
      const token = await this.createAuthToken(userId, 'EMAIL_VERIFY');
      await this.email.send(email, 'EMAIL_VERIFY', { token, firstName });
    } catch (error) {
      this.logger.error(`Failed to send confirmation email to ${email}`, error as Error);
    }
  }

  /** Always succeeds (doesn't reveal whether the email exists). */
  async resendConfirmation(email: string) {
    const user = await this.findUserByEmail(email);
    if (user && !user.isEmailVerified && user.isActive) await this.sendConfirmation(user.id, user.email, user.firstName);
    return { sent: true, message: 'If that email has an unconfirmed account, a new confirmation link is on its way.' };
  }

  async verifyEmail(token: string) {
    const row = await this.findLiveToken(token, ['EMAIL_VERIFY']);
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: row.userId }, data: { isEmailVerified: true } }),
    ]);
    return { verified: true };
  }

  /** Always succeeds (doesn't reveal whether the email exists). Link opens /set-password?token=…&reset=1. */
  async forgotPassword(email: string) {
    const user = await this.findUserByEmail(email);
    if (user) {
      try {
        // An invited user who never accepted gets a fresh invite instead (same /set-password page).
        const pendingInvite = !user.isActive && !user.hasPassword;
        const token = await this.createAuthToken(user.id, pendingInvite ? 'INVITE' : 'PASSWORD_RESET');
        await this.email.send(user.email, 'PASSWORD_RESET', { token, firstName: user.firstName || undefined });
      } catch (error) {
        this.logger.error(`Failed to send password reset to ${email}`, error as Error);
      }
    }
    return { sent: true, message: 'If an account exists for that email, a reset link is on its way. It expires in 1 hour.' };
  }

  /** What the /set-password page shows before the user submits (public). */
  async tokenInfo(token: string) {
    const row = await this.findLiveToken(token, ['INVITE', 'PASSWORD_RESET']);
    const user = await this.prisma.user.findUnique({ where: { id: row.userId }, select: { email: true, firstName: true, lastName: true, hasPassword: true } });
    const workspace = row.workspaceId
      ? await this.prisma.workspace.findUnique({ where: { id: row.workspaceId }, select: { id: true, name: true, logoUrl: true } })
      : null;
    return {
      type: row.type,
      email: user?.email,
      name: `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || null,
      needsName: !user?.firstName,
      workspace,
      expiresAt: row.expiresAt,
    };
  }

  /** Accept an invite / complete a reset: set the password (min 8), consume the single-use token, sign in. */
  async setPassword(dto: SetPasswordDto) {
    const row = await this.findLiveToken(dto.token, ['INVITE', 'PASSWORD_RESET']);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const names = dto.name ? splitName(dto.name) : null;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.emailVerificationToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException(friendly('This link has already been used.', 'TOKEN_INVALID'));
      await tx.user.update({
        where: { id: row.userId },
        data: {
          passwordHash,
          hasPassword: true,
          isActive: true,
          isEmailVerified: true,
          ...(names?.firstName ? { firstName: names.firstName, lastName: names.lastName, displayName: dto.name!.trim() } : {}),
        },
      });
      await tx.userSecurity.upsert({
        where: { userId: row.userId },
        create: { userId: row.userId, lastLoginAt: new Date() },
        update: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      if (row.type === 'INVITE' && row.workspaceId) {
        await tx.workspaceMember.updateMany({
          where: { userId: row.userId, workspaceId: row.workspaceId, joinedAt: null },
          data: { joinedAt: new Date() },
        });
      }
    });

    return this.buildSession(row.userId, row.type === 'INVITE' ? row.workspaceId : null);
  }

  // ─── Workspaces ───────────────────────────────────────────────────────────

  async switchWorkspace(user: { id: string; isPlatformAdmin?: boolean }, workspaceId: string) {
    return this.buildSession(user.id, workspaceId, { allowNonMember: !!user.isPlatformAdmin });
  }

  async listMyWorkspaces(userId: string, currentWorkspaceId?: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, isActive: true },
      include: { workspace: { select: { id: true, name: true, slug: true, logoUrl: true, status: true } } },
      orderBy: { invitedAt: 'asc' },
    });
    return memberships.map((m) => ({
      ...m.workspace,
      role: m.role,
      isBiller: m.isBiller,
      invited: !m.joinedAt,
      current: m.workspaceId === currentWorkspaceId,
    }));
  }

  /** "Create new workspace" from the switcher: the caller becomes its ADMIN and is switched into it. */
  async createWorkspace(userId: string, name: string) {
    const workspace = await this.prisma.$transaction(async (tx) => {
      const ws = await createWorkspaceRecord(tx, { name });
      await tx.workspaceMember.create({ data: { workspaceId: ws.id, userId, role: Role.ADMIN, joinedAt: new Date() } });
      return ws;
    });
    return this.buildSession(userId, workspace.id);
  }
}
