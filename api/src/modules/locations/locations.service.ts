import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditActor, AuditLogService } from '../platform/audit-log.service';
import { AUDIT_ACTIONS } from '../../common';
import { CreateLocationDto, UpdateLocationDto } from './dto';

/** BU Heads (spec: locations, children of a Business Unit). */
@Injectable()
export class LocationsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogService,
  ) {}

  async findAll(workspaceId: string, opts: { costCenterId?: string; activeOnly?: boolean } = {}) {
    return this.prisma.location.findMany({
      where: {
        workspaceId,
        ...(opts.costCenterId && { costCenterId: opts.costCenterId }),
        ...(opts.activeOnly && { isActive: true }),
      },
      include: { costCenter: { select: { id: true, name: true, code: true } } },
      orderBy: [{ costCenter: { sortOrder: 'asc' } }, { isGeneral: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  private async assertCostCenter(workspaceId: string, costCenterId: string) {
    const cc = await this.prisma.costCenter.findFirst({ where: { id: costCenterId, workspaceId } });
    if (!cc) throw new BadRequestException('Business unit not found');
    return cc;
  }

  /**
   * Validation helper for other modules: the BU head must belong to the given BU.
   * Null locationId is allowed.
   */
  async assertLocationInCostCenter(workspaceId: string, locationId: string | null | undefined, costCenterId: string | null | undefined) {
    if (!locationId) return null;
    const loc = await this.prisma.location.findFirst({ where: { id: locationId, workspaceId } });
    if (!loc) throw new BadRequestException('BU head not found');
    if (!costCenterId || loc.costCenterId !== costCenterId) throw new BadRequestException('BU head does not belong to the selected business unit');
    return loc;
  }

  private conflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('A BU head with this name already exists in this business unit');
    }
    throw error;
  }

  async create(workspaceId: string, dto: CreateLocationDto, actor?: AuditActor) {
    const cc = await this.assertCostCenter(workspaceId, dto.costCenterId);
    const agg = await this.prisma.location.aggregate({ where: { workspaceId, costCenterId: cc.id }, _max: { sortOrder: true } });
    try {
      const created = await this.prisma.location.create({
        data: {
          workspaceId,
          costCenterId: cc.id,
          name: dto.name.trim(),
          isGeneral: dto.isGeneral ?? false,
          address: dto.address,
          sortOrder: dto.sortOrder ?? (agg._max.sortOrder ?? -1) + 1,
        },
      });
      await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `BU head ${cc.name} · ${created.name}`, { action: 'bu_head.created', id: created.id });
      return created;
    } catch (error) {
      this.conflict(error);
    }
  }

  async update(workspaceId: string, id: string, dto: UpdateLocationDto, actor?: AuditActor) {
    const existing = await this.prisma.location.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException('BU head not found');
    if (dto.costCenterId) await this.assertCostCenter(workspaceId, dto.costCenterId);
    try {
      const updated = await this.prisma.location.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.costCenterId !== undefined && { costCenterId: dto.costCenterId }),
          ...(dto.isGeneral !== undefined && { isGeneral: dto.isGeneral }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
          ...(dto.address !== undefined && { address: dto.address }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
      await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `BU head ${updated.name}`, { action: 'bu_head.updated', id, changes: dto });
      return updated;
    } catch (error) {
      this.conflict(error);
    }
  }

  async remove(workspaceId: string, id: string, actor?: AuditActor) {
    const existing = await this.prisma.location.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException('BU head not found');
    const [q, b, r, rp] = await Promise.all([
      this.prisma.queueItem.count({ where: { workspaceId, locationId: id } }),
      this.prisma.batchItem.count({ where: { locationId: id } }),
      this.prisma.requisition.count({ where: { workspaceId, locationId: id } }),
      this.prisma.recurringPayment.count({ where: { workspaceId, locationId: id } }),
    ]);
    const inUse = q + b + r + rp > 0;
    if (inUse) await this.prisma.location.update({ where: { id }, data: { isActive: false } });
    else await this.prisma.location.delete({ where: { id } });
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `BU head ${existing.name}`, {
      action: inUse ? 'bu_head.deactivated' : 'bu_head.deleted',
      id,
    });
    return { success: true, deactivated: inUse };
  }

  async reorder(workspaceId: string, ids: string[]) {
    const owned = await this.prisma.location.count({ where: { workspaceId, id: { in: ids } } });
    if (owned !== new Set(ids).size) throw new NotFoundException('One or more BU heads were not found');
    await this.prisma.$transaction(ids.map((id, idx) => this.prisma.location.update({ where: { id }, data: { sortOrder: idx } })));
    return { success: true };
  }
}
