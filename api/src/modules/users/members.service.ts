import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuditLogService } from '../platform/audit-log.service';
import { AuthService, splitName } from '../auth/auth.service';
import { AUDIT_ACTIONS, CurrentUserData, Role } from '../../common';

type Actor = Pick<CurrentUserData, 'id' | 'email'> & { displayName?: string };

/** Spec §5.9 Users: members, invites, roles, biller flag. Admin-only writes (enforced in the controller). */
@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly audit: AuditLogService,
    private readonly auth: AuthService,
  ) {}

  async list(workspaceId: string) {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, isActive: true },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, displayName: true, avatarUrl: true, isActive: true, security: { select: { pinHash: true } } } },
      },
      orderBy: { invitedAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.user.id,
      userId: m.user.id,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      displayName: m.user.displayName || `${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      isBiller: m.isBiller,
      status: m.joinedAt && m.user.isActive ? 'active' : 'invited',
      hasPin: !!m.user.security?.pinHash,
      invitedAt: m.invitedAt,
      joinedAt: m.joinedAt,
    }));
  }

  /** Directory for display (spec profile_directory()): id → name for every member. */
  async directory(workspaceId: string) {
    const rows = await this.list(workspaceId);
    return rows.map((r) => ({ id: r.id, displayName: r.displayName, email: r.email, avatarUrl: r.avatarUrl, role: r.role }));
  }

  /**
   * Invite by email. Unknown emails get an inactive placeholder account; everyone gets an emailed
   * single-use /set-password link scoped to this workspace. Also used by onboarding and super-admin.
   */
  async invite(workspaceId: string, actor: Actor | null, dto: { name: string; email: string; role: Role; isBiller?: boolean }) {
    const email = dto.email.trim().toLowerCase();
    let user = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    const names = splitName(dto.name);

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 10),
          hasPassword: false,
          isActive: false,
          firstName: names.firstName,
          lastName: names.lastName,
          displayName: dto.name.trim() || undefined,
        },
      });
    } else if (!user.firstName && names.firstName) {
      user = await this.prisma.user.update({ where: { id: user.id }, data: { ...names, displayName: dto.name.trim() } });
    }

    const existing = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } });
    if (existing?.isActive) throw new ConflictException(`${email} is already in this workspace.`);

    const membership = existing
      ? await this.prisma.workspaceMember.update({
          where: { id: existing.id },
          data: { isActive: true, role: dto.role, isBiller: !!dto.isBiller, joinedAt: null, invitedAt: new Date(), invitedById: actor?.id },
        })
      : await this.prisma.workspaceMember.create({
          data: { workspaceId, userId: user.id, role: dto.role, isBiller: !!dto.isBiller, invitedById: actor?.id },
        });

    const sent = await this.sendInvite(workspaceId, user.id);
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.USER_INVITED, email, { role: dto.role, isBiller: !!dto.isBiller }, { type: 'user', id: user.id });
    return { userId: user.id, email, role: membership.role, isBiller: membership.isBiller, status: 'invited' as const, ...sent };
  }

  async resendInvite(workspaceId: string, actor: Actor, userId: string) {
    const m = await this.getMembership(workspaceId, userId);
    if (m.joinedAt && m.user.isActive) throw new BadRequestException(`${m.user.email} has already joined.`);
    const sent = await this.sendInvite(workspaceId, userId);
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.USER_INVITED, m.user.email, { resend: true }, { type: 'user', id: userId });
    return sent;
  }

  async editName(workspaceId: string, userId: string, name: string) {
    await this.getMembership(workspaceId, userId);
    const names = splitName(name);
    const u = await this.prisma.user.update({
      where: { id: userId },
      data: { ...names, displayName: name.trim() },
      select: { id: true, displayName: true, firstName: true, lastName: true },
    });
    return u;
  }

  async setRole(workspaceId: string, actor: Actor, userId: string, role: Role) {
    const m = await this.getMembership(workspaceId, userId);
    if (userId === actor.id && m.role === Role.ADMIN && role !== Role.ADMIN) {
      throw new ForbiddenException("You can't remove your own admin role. Ask another admin to do it.");
    }
    if (m.role === Role.ADMIN && role !== Role.ADMIN) await this.assertNotLastAdmin(workspaceId, userId);
    if (m.role === role) return { userId, role, isBiller: m.isBiller };
    await this.prisma.workspaceMember.update({ where: { id: m.id }, data: { role } });
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.ROLE_CHANGE, m.user.email, { from: m.role, to: role }, { type: 'user', id: userId });
    return { userId, role, isBiller: m.isBiller };
  }

  async setBiller(workspaceId: string, actor: Actor, userId: string, isBiller: boolean) {
    const m = await this.getMembership(workspaceId, userId);
    if (m.isBiller === isBiller) return { userId, role: m.role, isBiller };
    await this.prisma.workspaceMember.update({ where: { id: m.id }, data: { isBiller } });
    await this.audit.record(
      workspaceId,
      actor,
      AUDIT_ACTIONS.ROLE_CHANGE,
      m.user.email,
      { biller: isBiller ? 'granted' : 'removed', role: m.role },
      { type: 'user', id: userId },
    );
    return { userId, role: m.role, isBiller };
  }

  async remove(workspaceId: string, actor: Actor, userId: string) {
    if (userId === actor.id) throw new ForbiddenException("You can't remove yourself from the workspace.");
    const m = await this.getMembership(workspaceId, userId);
    if (m.role === Role.ADMIN) await this.assertNotLastAdmin(workspaceId, userId);
    await this.prisma.$transaction([
      this.prisma.workspaceMember.delete({ where: { id: m.id } }),
      this.prisma.emailVerificationToken.updateMany({ where: { userId, workspaceId, type: 'INVITE', usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.notificationPref.deleteMany({ where: { workspaceId, userId } }),
      this.prisma.pushSubscription.deleteMany({ where: { workspaceId, userId } }),
    ]);
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.USER_REMOVED, m.user.email, { role: m.role }, { type: 'user', id: userId });
    return { removed: true };
  }

  /**
   * Emails a fresh single-use invite link. If delivery fails the invite still stands and the link is
   * returned (`inviteUrl`) so the admin can share it by hand; it is never returned when the email went out.
   */
  private async sendInvite(workspaceId: string, userId: string): Promise<{ emailSent: boolean; inviteUrl?: string }> {
    const [user, workspace] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
    ]);
    if (!user) return { emailSent: false };
    const token = await this.auth.createAuthToken(userId, 'INVITE', workspaceId);
    try {
      await this.email.send(user.email, 'INVITE', { token, workspaceName: workspace?.name || 'your workspace', firstName: user.firstName || undefined });
      return { emailSent: true };
    } catch (error) {
      this.logger.error(`Failed to send invite email to ${user.email}`, error as Error);
      return { emailSent: false, inviteUrl: `${this.email.frontendBaseUrl}/set-password?token=${token}` };
    }
  }

  private async getMembership(workspaceId: string, userId: string) {
    const m = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { user: { select: { email: true, isActive: true } } },
    });
    if (!m || !m.isActive) throw new NotFoundException('That person is not in this workspace.');
    return m;
  }

  private async assertNotLastAdmin(workspaceId: string, userId: string) {
    const admins = await this.prisma.workspaceMember.count({ where: { workspaceId, role: Role.ADMIN, isActive: true, userId: { not: userId } } });
    if (admins === 0) throw new ForbiddenException('A workspace needs at least one admin.');
  }
}
