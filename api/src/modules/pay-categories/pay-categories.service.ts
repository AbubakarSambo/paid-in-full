import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, AuditActor } from '../platform/audit-log.service';
import { AUDIT_ACTIONS } from '../../common';
import { CreatePayCategoryDto, ReorderDto, UpdatePayCategoryDto } from './dto';

/** Spec §11 category colour palette. */
export const CATEGORY_PALETTE = ['#22D3EE', '#7AB87A', '#5BA8C9', '#C97A7A', '#B59ED4', '#E89B59', '#8B8FA3'];

@Injectable()
export class PayCategoriesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogService,
  ) {}

  async findAll(workspaceId: string, opts: { includeTags?: boolean; activeOnly?: boolean } = {}) {
    return this.prisma.payCategory.findMany({
      where: { workspaceId, ...(opts.activeOnly && { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { coaTags: true } },
        ...(opts.includeTags && {
          coaTags: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
        }),
      },
    });
  }

  async findOne(workspaceId: string, id: string) {
    const existing = await this.prisma.payCategory.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException('Pay category not found');
    return existing;
  }

  async create(workspaceId: string, dto: CreatePayCategoryDto, actor?: AuditActor) {
    const name = dto.name.trim();
    const agg = await this.prisma.payCategory.aggregate({ where: { workspaceId }, _max: { sortOrder: true }, _count: true });
    try {
      const created = await this.prisma.payCategory.create({
        data: {
          workspaceId,
          name,
          code: dto.code,
          color: dto.color ?? CATEGORY_PALETTE[agg._count % CATEGORY_PALETTE.length],
          includeInBudgets: dto.includeInBudgets ?? false,
          sortOrder: dto.sortOrder ?? (agg._max.sortOrder ?? -1) + 1,
        },
      });
      await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CATEGORY_CREATED, created.name, { id: created.id, color: created.color }, { type: 'pay_category', id: created.id });
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A pay category with this name already exists');
      }
      throw error;
    }
  }

  async update(workspaceId: string, id: string, dto: UpdatePayCategoryDto, actor?: AuditActor) {
    const existing = await this.findOne(workspaceId, id);
    const name = dto.name?.trim();
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.payCategory.update({
          where: { id },
          data: {
            ...(name !== undefined && { name }),
            ...(dto.code !== undefined && { code: dto.code }),
            ...(dto.color !== undefined && { color: dto.color }),
            ...(dto.includeInBudgets !== undefined && { includeInBudgets: dto.includeInBudgets }),
            ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
            ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          },
        });
        // Rename: keep the denormalised name on not-yet-approved queue items in step.
        // Approved batches keep the name they were approved under (historical record).
        if (name !== undefined && name !== existing.name) {
          await tx.queueItem.updateMany({
            where: { workspaceId, payCategoryId: id, status: 'PENDING' },
            data: { payCategoryName: name },
          });
        }
        return row;
      });
      await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CATEGORY_UPDATED, updated.name, {
        id,
        changes: dto,
        ...(name !== undefined && name !== existing.name && { renamedFrom: existing.name }),
      }, { type: 'pay_category', id });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A pay category with this name already exists');
      }
      throw error;
    }
  }

  /** How many records reference this category (delete is blocked when any are > 0). */
  async usage(workspaceId: string, id: string) {
    const coaIds = (await this.prisma.coaTag.findMany({ where: { workspaceId, payCategoryId: id }, select: { id: true } })).map((c) => c.id);
    const coaFilter = coaIds.length ? { coaTagId: { in: coaIds } } : undefined;
    const byCat = (extra?: object) => ({ workspaceId, OR: [{ payCategoryId: id }, ...(extra ? [extra] : [])] });
    const [queueItems, batches, batchItems, requisitions, recurringPayments, stockExpenses, budgets] = await Promise.all([
      this.prisma.queueItem.count({ where: byCat(coaFilter) }),
      this.prisma.batch.count({ where: { workspaceId, payCategoryId: id } }),
      this.prisma.batchItem.count({ where: { batch: { workspaceId }, OR: [{ payCategoryId: id }, ...(coaFilter ? [coaFilter] : [])] } }),
      this.prisma.requisition.count({ where: byCat(coaFilter) }),
      this.prisma.recurringPayment.count({ where: byCat(coaFilter) }),
      this.prisma.stockExpense.count({ where: byCat(coaFilter) }),
      coaIds.length ? this.prisma.budget.count({ where: { workspaceId, coaTagId: { in: coaIds } } }) : Promise.resolve(0),
    ]);
    const counts = { queueItems, batches, batchItems, requisitions, recurringPayments, stockExpenses, budgets };
    return { counts, inUse: Object.values(counts).some((n) => n > 0) };
  }

  async remove(workspaceId: string, id: string, actor?: AuditActor) {
    const existing = await this.findOne(workspaceId, id);
    const { counts, inUse } = await this.usage(workspaceId, id);
    if (inUse) {
      throw new ConflictException({
        message: `"${existing.name}" is in use and can't be deleted. Rename it or turn it off instead.`,
        usage: counts,
      });
    }
    await this.prisma.payCategory.delete({ where: { id } }); // cascades its (unused) COA tags
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CATEGORY_DELETED, existing.name, { id }, { type: 'pay_category', id });
    return { success: true };
  }

  async reorder(workspaceId: string, dto: ReorderDto, actor?: AuditActor) {
    const owned = await this.prisma.payCategory.count({ where: { workspaceId, id: { in: dto.ids } } });
    if (owned !== new Set(dto.ids).size) throw new NotFoundException('One or more pay categories were not found');
    await this.prisma.$transaction(
      dto.ids.map((id, idx) => this.prisma.payCategory.update({ where: { id }, data: { sortOrder: idx } })),
    );
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CATEGORY_UPDATED, 'reorder', { ids: dto.ids });
    return this.findAll(workspaceId);
  }
}
