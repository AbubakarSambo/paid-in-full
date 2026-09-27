import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../../common';
import { ListAuditLogDto } from './dto/list-audit-log.dto';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget-friendly helper other modules can call to write an audit trail entry.
   * Never throws — audit logging must not be able to break the calling business operation.
   */
  async record(
    workspaceId: string | null,
    userId: string | null,
    action: string,
    entityType: string,
    entityId?: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          workspaceId: workspaceId ?? undefined,
          userId: userId ?? undefined,
          action,
          entityType,
          entityId: entityId ?? undefined,
          metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to record audit log entry (action=${action}, entityType=${entityType})`, error as Error);
    }
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
