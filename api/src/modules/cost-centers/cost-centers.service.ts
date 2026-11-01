import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditActor, AuditLogService } from '../platform/audit-log.service';
import { AUDIT_ACTIONS } from '../../common';
import { CreateCostCenterDto, UpdateCostCenterDto } from './dto';

export const GENERAL_HEAD_NAME = '✦ General (split)';

/** Business Units (spec: cost_centers). */
@Injectable()
export class CostCentersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogService,
  ) {}

  async findAll(workspaceId: string, opts: { includeHeads?: boolean; activeOnly?: boolean } = {}) {
    return this.prisma.costCenter.findMany({
      where: { workspaceId, ...(opts.activeOnly && { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      ...(opts.includeHeads && {
        include: {
          locations: {
            where: opts.activeOnly ? { isActive: true } : undefined,
            orderBy: [{ isGeneral: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
          },
        },
      }),
    });
  }

  async findOne(workspaceId: string, id: string) {
    const existing = await this.prisma.costCenter.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException('Business unit not found');
    return existing;
  }

  private conflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('A business unit with this name already exists');
    }
    throw error;
  }

  async create(workspaceId: string, dto: CreateCostCenterDto, actor?: AuditActor) {
    const agg = await this.prisma.costCenter.aggregate({ where: { workspaceId }, _max: { sortOrder: true } });
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const cc = await tx.costCenter.create({
          data: {
            workspaceId,
            name: dto.name.trim(),
            code: dto.code?.trim().toUpperCase() || null,
            sortOrder: dto.sortOrder ?? (agg._max.sortOrder ?? -1) + 1,
          },
        });
        if (dto.createGeneralHead) {
          await tx.location.create({ data: { workspaceId, costCenterId: cc.id, name: GENERAL_HEAD_NAME, isGeneral: true, sortOrder: 0 } });
        }
        return cc;
      });
      await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `Business unit ${created.name}`, { action: 'business_unit.created', id: created.id });
      return created;
    } catch (error) {
      this.conflict(error);
    }
  }

  async update(workspaceId: string, id: string, dto: UpdateCostCenterDto, actor?: AuditActor) {
    await this.findOne(workspaceId, id);
    try {
      const updated = await this.prisma.costCenter.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.code !== undefined && { code: dto.code?.trim().toUpperCase() || null }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
      await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `Business unit ${updated.name}`, { action: 'business_unit.updated', id, changes: dto });
      return updated;
    } catch (error) {
      this.conflict(error);
    }
  }

  /** Hard-deletes an unused BU (and its heads); a BU referenced by history is deactivated instead. */
  async remove(workspaceId: string, id: string, actor?: AuditActor) {
    const existing = await this.findOne(workspaceId, id);
    const [q, b, r, rp, bud] = await Promise.all([
      this.prisma.queueItem.count({ where: { workspaceId, costCenterId: id } }),
      this.prisma.batchItem.count({ where: { costCenterId: id } }),
      this.prisma.requisition.count({ where: { workspaceId, costCenterId: id } }),
      this.prisma.recurringPayment.count({ where: { workspaceId, costCenterId: id } }),
      this.prisma.budget.count({ where: { workspaceId, costCenterId: id } }),
    ]);
    const inUse = q + b + r + rp + bud > 0;
    if (inUse) {
      await this.prisma.$transaction([
        this.prisma.costCenter.update({ where: { id }, data: { isActive: false } }),
        this.prisma.location.updateMany({ where: { workspaceId, costCenterId: id }, data: { isActive: false } }),
      ]);
    } else {
      await this.prisma.costCenter.delete({ where: { id } });
    }
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `Business unit ${existing.name}`, {
      action: inUse ? 'business_unit.deactivated' : 'business_unit.deleted',
      id,
    });
    return { success: true, deactivated: inUse };
  }

  async reorder(workspaceId: string, ids: string[]) {
    const owned = await this.prisma.costCenter.count({ where: { workspaceId, id: { in: ids } } });
    if (owned !== new Set(ids).size) throw new NotFoundException('One or more business units were not found');
    await this.prisma.$transaction(ids.map((id, idx) => this.prisma.costCenter.update({ where: { id }, data: { sortOrder: idx } })));
    return this.findAll(workspaceId, { includeHeads: true });
  }
}
