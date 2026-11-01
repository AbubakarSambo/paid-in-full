import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChargeStatus, CustomerSubscriptionStatus, PayoutStatus, PlatformRole, Prisma, WorkspaceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../platform/audit-log.service';
import { MembersService } from '../users/members.service';
import { AuthService } from '../auth/auth.service';
import { createWorkspaceRecord } from '../workspaces/workspace-factory';
import { addPeriod, pifDueInfo, subscriptionStatusFor } from '../billing/pif-billing';
import { CurrentUserData, isSuperAdmin, Role } from '../../common';
import { ListClientsDto, ManageClientDto, NewClientDto } from './dto';

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? null : Number(d));

/**
 * Spec §14 super-admin console. SUPER_ADMIN sees everything; CLIENT_SETUP staff can list and create
 * clients but every money figure is stripped from what they get back.
 */
@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly members: MembersService,
    private readonly auth: AuthService,
  ) {}

  async kpis(viewer: CurrentUserData) {
    const [total, active, trial, paused, mrr] = await Promise.all([
      this.prisma.workspace.count(),
      this.prisma.workspace.count({ where: { status: WorkspaceStatus.ACTIVE } }),
      this.prisma.workspace.count({ where: { status: WorkspaceStatus.TRIAL } }),
      this.prisma.workspace.count({ where: { status: { in: [WorkspaceStatus.PAUSED, WorkspaceStatus.SUSPENDED] } } }),
      this.prisma.workspace.aggregate({ where: { status: WorkspaceStatus.ACTIVE }, _sum: { monthlyAmount: true } }),
    ]);
    return {
      totalClients: total,
      activeClients: active,
      trialClients: trial,
      pausedClients: paused,
      ...(isSuperAdmin(viewer) ? { monthlyRecurring: num(mrr._sum.monthlyAmount) ?? 0 } : {}),
    };
  }

  async listClients(viewer: CurrentUserData, query: ListClientsDto) {
    const where: Prisma.WorkspaceWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const workspaces = await this.prisma.workspace.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { _count: { select: { batches: true, members: { where: { isActive: true } } } } },
    });
    const ids = workspaces.map((w) => w.id);
    const [disbursed, activity] = await Promise.all([
      ids.length
        ? this.prisma.batchItemPayout.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids }, status: PayoutStatus.SUCCESS }, _sum: { amount: true } })
        : [],
      ids.length ? this.prisma.auditLog.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids } }, _max: { createdAt: true } }) : [],
    ]);
    const disbursedBy = new Map(disbursed.map((d) => [d.workspaceId, num(d._sum.amount) ?? 0]));
    const activityBy = new Map(activity.map((a) => [a.workspaceId, a._max.createdAt]));
    return workspaces.map((w) => this.shapeClient(viewer, w, disbursedBy.get(w.id) ?? 0, activityBy.get(w.id) ?? null));
  }

  async getClient(viewer: CurrentUserData, id: string) {
    const w = await this.prisma.workspace.findUnique({
      where: { id },
      include: { _count: { select: { batches: true, members: { where: { isActive: true } } } } },
    });
    if (!w) throw new NotFoundException('Client not found');
    const [disbursed, last, admins] = await Promise.all([
      this.prisma.batchItemPayout.aggregate({ where: { workspaceId: id, status: PayoutStatus.SUCCESS }, _sum: { amount: true } }),
      this.prisma.auditLog.findFirst({ where: { workspaceId: id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.prisma.workspaceMember.findMany({
        where: { workspaceId: id, role: Role.ADMIN, isActive: true },
        include: { user: { select: { id: true, email: true, displayName: true, firstName: true, lastName: true } } },
      }),
    ]);
    return {
      ...this.shapeClient(viewer, w, num(disbursed._sum.amount) ?? 0, last?.createdAt ?? null),
      admins: admins.map((a) => ({
        id: a.user.id,
        email: a.user.email,
        name: a.user.displayName || `${a.user.firstName} ${a.user.lastName}`.trim(),
        status: a.joinedAt ? 'active' : 'invited',
      })),
    };
  }

  private shapeClient(
    viewer: CurrentUserData,
    w: Prisma.WorkspaceGetPayload<{ include: { _count: { select: { batches: true; members: true } } } }>,
    totalDisbursed: number,
    lastActivityAt: Date | null,
  ) {
    const due = pifDueInfo(w);
    const base = {
      id: w.id,
      name: w.name,
      slug: w.slug,
      logoUrl: w.logoUrl,
      status: w.status,
      tier: w.tier,
      billingDay: w.billingDay,
      paidUntil: w.paidUntil,
      nextDueDate: due.nextDue,
      overdue: due.overdue,
      graceEndsAt: due.graceEndsAt,
      trialEndDate: w.trialEndDate,
      notes: w.notes,
      members: w._count.members,
      batches: w._count.batches,
      lastActivityAt: lastActivityAt ?? w.updatedAt,
      createdAt: w.createdAt,
    };
    if (!isSuperAdmin(viewer)) return base;
    return { ...base, monthlyAmount: num(w.monthlyAmount), totalDisbursed };
  }

  async manageClient(actor: CurrentUserData, id: string, dto: ManageClientDto) {
    const w = await this.prisma.workspace.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('Client not found');

    const data: Prisma.WorkspaceUpdateInput = {};
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.billingDay !== undefined) data.billingDay = dto.billingDay;
    if (dto.trialEndDate !== undefined) data.trialEndDate = dto.trialEndDate ? new Date(dto.trialEndDate) : null;
    if (dto.nextDueDate !== undefined) data.nextDueDate = dto.nextDueDate ? new Date(dto.nextDueDate) : null;
    if (dto.monthlyAmount !== undefined) data.monthlyAmount = dto.monthlyAmount;

    if (dto.tier !== undefined) {
      data.tier = dto.tier;
      if (dto.tier) {
        const plan = await this.prisma.billingPlan.findFirst({
          where: { OR: [{ name: { equals: dto.tier, mode: 'insensitive' } }, ...(isPlanTier(dto.tier) ? [{ tier: dto.tier.toUpperCase() as never }] : [])] },
        });
        if (plan) {
          data.planTier = plan.tier;
          if (dto.monthlyAmount === undefined) data.monthlyAmount = plan.priceMonthly;
        }
      }
    }

    let paidUntil: Date | null | undefined;
    if (dto.paidUntil !== undefined) paidUntil = dto.paidUntil ? new Date(dto.paidUntil) : null;
    if (dto.extendPaidUntil) {
      const base = (paidUntil ?? w.paidUntil) && (paidUntil ?? w.paidUntil)! > new Date() ? (paidUntil ?? w.paidUntil)! : new Date();
      paidUntil = addPeriod(base, dto.extendPaidUntil);
    }
    let status = dto.status;
    if (paidUntil !== undefined) {
      data.paidUntil = paidUntil;
      // Paid forward: the next due date is when the paid period ends; a paused client comes back.
      if (paidUntil && dto.nextDueDate === undefined) data.nextDueDate = paidUntil;
      if (paidUntil && paidUntil > new Date() && !status && (w.status === WorkspaceStatus.PAUSED || w.status === WorkspaceStatus.TRIAL)) {
        status = WorkspaceStatus.ACTIVE;
      }
    }
    if (status) {
      data.status = status;
      data.subscriptionStatus = subscriptionStatusFor(status);
    }

    const updated = await this.prisma.workspace.update({ where: { id }, data, include: { _count: { select: { batches: true, members: { where: { isActive: true } } } } } });
    await this.audit.record(null, actor, 'client.updated', w.name, { workspaceId: id, changes: JSON.parse(JSON.stringify(data)) }, { type: 'workspace', id });
    return this.shapeClient(actor, updated, 0, null);
  }

  async deleteClient(actor: CurrentUserData, id: string, confirmName: string) {
    const w = await this.prisma.workspace.findUnique({ where: { id }, select: { id: true, name: true, slug: true } });
    if (!w) throw new NotFoundException('Client not found');
    if ((confirmName || '').trim().toLowerCase() !== w.name.trim().toLowerCase()) {
      throw new BadRequestException(`Type the workspace name "${w.name}" exactly to confirm.`);
    }
    if (id === actor.workspaceId) throw new ForbiddenException("Switch out of this workspace before deleting it.");
    await this.prisma.workspace.delete({ where: { id } });
    await this.audit.record(null, actor, 'client.deleted', w.name, { workspaceId: id, slug: w.slug }, { type: 'workspace', id });
    return { deleted: true };
  }

  /** "New client": creates the workspace and emails an admin invite. */
  async newClient(actor: CurrentUserData, dto: NewClientDto) {
    if (dto.slug && (await this.prisma.workspace.findUnique({ where: { slug: dto.slug }, select: { id: true } }))) {
      throw new ConflictException(`The slug "${dto.slug}" is taken.`);
    }
    const monthlyAmount = isSuperAdmin(actor) ? dto.monthlyAmount ?? null : null;
    const workspace = await this.prisma.$transaction((tx) =>
      createWorkspaceRecord(tx, { name: dto.businessName, slug: dto.slug, status: WorkspaceStatus.TRIAL, monthlyAmount }),
    );
    const invite = await this.members.invite(workspace.id, actor, { name: dto.adminName, email: dto.adminEmail, role: Role.ADMIN });
    await this.audit.record(null, actor, 'client.created', workspace.name, { workspaceId: workspace.id, adminEmail: invite.email }, { type: 'workspace', id: workspace.id });
    return { id: workspace.id, name: workspace.name, slug: workspace.slug, status: workspace.status, admin: invite };
  }

  /** "Open workspace": a session token scoped to the client workspace (super admin only). */
  openClient(actor: CurrentUserData, id: string) {
    return this.auth.buildSession(actor.id, id, { allowNonMember: true });
  }

  // ─── Client setup team ──────────────────────────────────────────────────

  async listTeam() {
    const users = await this.prisma.user.findMany({
      where: { platformRole: { not: null } },
      select: { id: true, email: true, firstName: true, lastName: true, displayName: true, platformRole: true, createdAt: true },
      orderBy: { email: 'asc' },
    });
    return users.map((u) => ({ ...u, name: u.displayName || `${u.firstName} ${u.lastName}`.trim() }));
  }

  async grantClientSetup(actor: CurrentUserData, email: string) {
    const user = await this.prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } });
    if (!user) throw new NotFoundException(`No account uses ${email}. They need to sign up (or be invited) first.`);
    if (user.platformRole === PlatformRole.SUPER_ADMIN) throw new BadRequestException(`${user.email} is already a super admin.`);
    if (user.platformRole === PlatformRole.CLIENT_SETUP) return { email: user.email, platformRole: user.platformRole };
    await this.prisma.user.update({ where: { id: user.id }, data: { platformRole: PlatformRole.CLIENT_SETUP } });
    await this.audit.record(null, actor, 'platform.role_granted', user.email, { platformRole: 'CLIENT_SETUP' }, { type: 'user', id: user.id });
    return { email: user.email, platformRole: PlatformRole.CLIENT_SETUP };
  }

  async removeClientSetup(actor: CurrentUserData, email: string) {
    const user = await this.prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } });
    if (!user || user.platformRole !== PlatformRole.CLIENT_SETUP) throw new NotFoundException(`${email} is not on the client setup team.`);
    await this.prisma.user.update({ where: { id: user.id }, data: { platformRole: null } });
    await this.audit.record(null, actor, 'platform.role_removed', user.email, { platformRole: 'CLIENT_SETUP' }, { type: 'user', id: user.id });
    return { email: user.email, platformRole: null };
  }

  // ─── Auto-debit (all clients), read-only ────────────────────────────────

  async autoDebitOverview() {
    const [subscriptions, settlements, totals] = await Promise.all([
      this.prisma.customerSubscription.findMany({
        orderBy: { createdAt: 'desc' },
        take: 300,
        include: { workspace: { select: { id: true, name: true } }, customer: { select: { id: true, name: true } } },
      }),
      this.prisma.customerSubscriptionCharge.findMany({
        where: { status: ChargeStatus.SUCCESS },
        orderBy: { attemptedAt: 'desc' },
        take: 300,
        include: {
          subscription: {
            select: { planName: true, workspace: { select: { id: true, name: true } }, customer: { select: { id: true, name: true } } },
          },
        },
      }),
      this.prisma.customerSubscriptionCharge.aggregate({
        where: { status: ChargeStatus.SUCCESS },
        _sum: { amount: true, feeAmount: true, netAmount: true },
        _count: true,
      }),
    ]);

    const subRows = subscriptions.map((s) => ({
      id: s.id,
      workspace: s.workspace,
      customer: s.customer,
      planName: s.planName,
      amount: num(s.amount),
      interval: s.interval,
      status: s.status,
      nextRunAt: s.nextRunAt,
      lastChargedAt: s.lastChargedAt,
      mandateType: s.mandateType,
      mandateReference: s.mandateReference,
      cardLast4: s.cardLast4,
      authorisedAt: s.authorisedAt,
    }));

    return {
      summary: {
        subscriptions: subRows.length,
        activeMandates: subRows.filter((s) => s.status === CustomerSubscriptionStatus.ACTIVE && (s.mandateReference || s.cardLast4)).length,
        pendingMandates: subRows.filter((s) => s.status === CustomerSubscriptionStatus.PENDING_MANDATE).length,
        settledCharges: totals._count,
        gross: num(totals._sum.amount) ?? 0,
        fees: num(totals._sum.feeAmount) ?? 0,
        net: num(totals._sum.netAmount) ?? 0,
      },
      subscriptions: subRows,
      mandates: subRows.filter((s) => s.status === CustomerSubscriptionStatus.ACTIVE && (s.mandateReference || s.cardLast4 || s.mandateType)),
      settlements: settlements.map((c) => ({
        id: c.id,
        reference: c.reference,
        workspace: c.subscription.workspace,
        customer: c.subscription.customer,
        planName: c.subscription.planName,
        gross: num(c.amount),
        fee: num(c.feeAmount),
        net: num(c.netAmount) ?? (num(c.amount) ?? 0) - (num(c.feeAmount) ?? 0),
        settledAt: c.settledAt ?? c.attemptedAt,
      })),
    };
  }
}

function isPlanTier(tier: string) {
  return ['STARTER', 'GROWTH', 'ENTERPRISE'].includes(tier.toUpperCase());
}
