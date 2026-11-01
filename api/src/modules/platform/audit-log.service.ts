import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../../common/dto/pagination.dto';
import { ListAuditLogDto } from './dto/list-audit-log.dto';

/** Who did it: a CurrentUserData-like object, a bare user id, or null for system jobs. */
export type AuditActor = { id: string; email?: string | null } | string | null | undefined;

export interface AuditEntity {
  type: string;
  id?: string | null;
}

type AuditClient = Prisma.TransactionClient | PrismaService;

/**
 * Global (see AuditModule): inject AuditLogService anywhere without importing a module.
 *
 *   await this.audit.record(user.workspaceId, user, AUDIT_ACTIONS.BATCH_APPROVED, batch.batchRef, { total });
 *
 * record() never throws. Use recordTx(tx, ...) to write inside an existing transaction (it DOES
 * throw, so the audit row commits/rolls back with the business change).
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async buildData(
    client: AuditClient,
    workspaceId: string | null,
    actor: AuditActor,
    action: string,
    target?: string | null,
    metadata?: Record<string, unknown> | null,
    entity?: AuditEntity,
  ): Promise<Prisma.AuditLogUncheckedCreateInput> {
    let userId: string | null = null;
    let actorEmail: string | null = null;
    if (typeof actor === 'string') {
      userId = actor;
    } else if (actor) {
      userId = actor.id;
      actorEmail = actor.email ?? null;
    }
    if (userId && !actorEmail) {
      const u = await client.user.findUnique({ where: { id: userId }, select: { email: true } });
      actorEmail = u?.email ?? null;
    }
    return {
      workspaceId: workspaceId ?? undefined,
      userId: userId ?? undefined,
      actorEmail: actorEmail ?? undefined,
      action,
      target: target ?? undefined,
      entityType: entity?.type,
      entityId: entity?.id ?? undefined,
      metadata: metadata ? (JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue) : undefined,
    };
  }

  /** Fire-and-forget-friendly. Never throws: audit logging must not break the business operation. */
  async record(
    workspaceId: string | null,
    actor: AuditActor,
    action: string,
    target?: string | null,
    metadata?: Record<string, unknown> | null,
    entity?: AuditEntity,
  ): Promise<void> {
    try {
      const data = await this.buildData(this.prisma, workspaceId, actor, action, target, metadata, entity);
      await this.prisma.auditLog.create({ data });
    } catch (error) {
      this.logger.error(`Failed to record audit log entry (action=${action})`, error as Error);
    }
  }

  /** Same as record() but inside the caller's transaction; throws on failure. */
  async recordTx(
    tx: Prisma.TransactionClient,
    workspaceId: string | null,
    actor: AuditActor,
    action: string,
    target?: string | null,
    metadata?: Record<string, unknown> | null,
    entity?: AuditEntity,
  ): Promise<void> {
    const data = await this.buildData(tx, workspaceId, actor, action, target, metadata, entity);
    await tx.auditLog.create({ data });
  }

  /** Settings → Audit log: the latest N entries for one workspace (spec: last 100). */
  async listForWorkspace(workspaceId: string, limit = 100) {
    return this.prisma.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
      select: {
        id: true,
        action: true,
        target: true,
        actorEmail: true,
        userId: true,
        entityType: true,
        entityId: true,
        metadata: true,
        createdAt: true,
      },
    });
  }

  async list(query: ListAuditLogDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.AuditLogWhereInput = {};
    if (query.workspaceId) where.workspaceId = query.workspaceId;
    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) (where.createdAt as Prisma.DateTimeFilter).gte = query.startDate;
      if (query.endDate) (where.createdAt as Prisma.DateTimeFilter).lte = query.endDate;
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          workspace: { select: { id: true, name: true } },
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }
}
