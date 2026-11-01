import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditActor, AuditLogService } from '../platform/audit-log.service';
import { AUDIT_ACTIONS, parseCsvBool, parseCsvRecords, toCsv } from '../../common';
import { assertCoaBelongsToCategory } from '../coa-tags/coa-tags.validation';
import { CreateStockExpenseDto, ImportStockCsvDto, StockQueryDto, UpdateStockExpenseDto } from './dto';

const INCLUDE = {
  payCategory: { select: { id: true, name: true, color: true } },
  coaTag: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
} satisfies Prisma.StockExpenseInclude;

/** Stock Expenses (spec §5.5): reusable line items picked when adding to the queue. */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async list(workspaceId: string, query: StockQueryDto) {
    const s = query.search?.trim();
    return this.prisma.stockExpense.findMany({
      where: {
        workspaceId,
        ...(query.active !== undefined && { isActive: query.active }),
        ...(s && {
          OR: [
            { name: { contains: s, mode: 'insensitive' } },
            { description: { contains: s, mode: 'insensitive' } },
            { unitName: { contains: s, mode: 'insensitive' } },
            { vendor: { name: { contains: s, mode: 'insensitive' } } },
            { coaTag: { name: { contains: s, mode: 'insensitive' } } },
            { payCategory: { name: { contains: s, mode: 'insensitive' } } },
          ],
        }),
      },
      include: INCLUDE,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(workspaceId: string, id: string) {
    const row = await this.prisma.stockExpense.findFirst({ where: { id, workspaceId }, include: INCLUDE });
    if (!row) throw new NotFoundException('Stock item not found');
    return row;
  }

  private async validateRefs(workspaceId: string, payCategoryId?: string | null, coaTagId?: string | null, vendorId?: string | null) {
    if (payCategoryId) {
      const cat = await this.prisma.payCategory.findFirst({ where: { id: payCategoryId, workspaceId }, select: { id: true } });
      if (!cat) throw new BadRequestException('Payment category not found');
    }
    if (coaTagId) await assertCoaBelongsToCategory(this.prisma, workspaceId, coaTagId, payCategoryId);
    if (vendorId) {
      const v = await this.prisma.vendor.findFirst({ where: { id: vendorId, workspaceId }, select: { id: true } });
      if (!v) throw new BadRequestException('Vendor not found');
    }
  }

  private conflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('A stock item with this name already exists');
    }
    throw error;
  }

  async create(workspaceId: string, dto: CreateStockExpenseDto, actor?: AuditActor) {
    await this.validateRefs(workspaceId, dto.payCategoryId, dto.coaTagId, dto.vendorId);
    try {
      const row = await this.prisma.stockExpense.create({
        data: {
          workspaceId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          payCategoryId: dto.payCategoryId ?? null,
          coaTagId: dto.coaTagId ?? null,
          vendorId: dto.vendorId ?? null,
          unitName: dto.unitName?.trim() || null,
          unitAmount: dto.unitAmount ?? 0,
          isActive: dto.isActive ?? true,
        },
        include: INCLUDE,
      });
      await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `Stock item ${row.name}`, { action: 'stock.created', id: row.id });
      return row;
    } catch (error) {
      this.conflict(error);
    }
  }

  async update(workspaceId: string, id: string, dto: UpdateStockExpenseDto, actor?: AuditActor) {
    const existing = await this.findOne(workspaceId, id);
    const payCategoryId = dto.payCategoryId !== undefined ? dto.payCategoryId : existing.payCategoryId;
    let coaTagId = dto.coaTagId !== undefined ? dto.coaTagId : existing.coaTagId;
    // Changing category without a new COA clears a COA that no longer belongs.
    if (dto.payCategoryId !== undefined && dto.coaTagId === undefined && dto.payCategoryId !== existing.payCategoryId) coaTagId = null;
    await this.validateRefs(workspaceId, payCategoryId, coaTagId, dto.vendorId);
    try {
      const row = await this.prisma.stockExpense.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
          payCategoryId,
          coaTagId,
          ...(dto.vendorId !== undefined && { vendorId: dto.vendorId }),
          ...(dto.unitName !== undefined && { unitName: dto.unitName?.trim() || null }),
          ...(dto.unitAmount !== undefined && { unitAmount: dto.unitAmount }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
        include: INCLUDE,
      });
      await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `Stock item ${row.name}`, { action: 'stock.updated', id, changes: dto });
      return row;
    } catch (error) {
      this.conflict(error);
    }
  }

  async remove(workspaceId: string, id: string, actor?: AuditActor) {
    const existing = await this.findOne(workspaceId, id);
    await this.prisma.stockExpense.delete({ where: { id } });
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `Stock item ${existing.name}`, { action: 'stock.deleted', id });
    return { success: true };
  }

  templateCsv() {
    return toCsv(
      ['name', 'description', 'category', 'coa', 'vendor', 'unit_name', 'unit_price', 'active'],
      [
        ['Diesel per litre', 'Diesel – Generator', 'OPEX', 'Fuel & Lubricants', '', 'litre', '1250', 'yes'],
        ['Bag of Cement', 'Cement – Dangote 50kg', 'PROPERTY', 'Structural & Construction', '', 'bag', '9500', 'yes'],
      ],
    );
  }

  /** Upsert by name. Category / COA / vendor are matched by name (case-insensitive). */
  async importCsv(workspaceId: string, dto: ImportStockCsvDto, actor?: AuditActor) {
    const { records } = parseCsvRecords(dto.csv, {
      name: ['name', 'item', 'stockitem'],
      description: ['description', 'desc', 'defaultdescription'],
      category: ['category', 'paycategory', 'paymentcategory'],
      coa: ['coa', 'coatag'],
      vendor: ['vendor', 'defaultvendor', 'vendorname'],
      unitName: ['unitname', 'unit'],
      unitPrice: ['unitprice', 'price', 'unitamount', 'defaultunitprice', 'amount'],
      active: ['active', 'isactive'],
    });
    if (!records.length) throw new BadRequestException('The CSV has no rows (a header row is required)');
    if (records.length > 1000) throw new BadRequestException('Import at most 1000 stock items at a time');

    const [cats, tags, vendors] = await Promise.all([
      this.prisma.payCategory.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
      this.prisma.coaTag.findMany({ where: { workspaceId, isActive: true }, select: { id: true, name: true, payCategoryId: true } }),
      this.prisma.vendor.findMany({ where: { workspaceId, isActive: true }, select: { id: true, name: true } }),
    ]);
    const lc = (s?: string) => (s ?? '').trim().toLowerCase();

    const created: string[] = [];
    const updated: string[] = [];
    const errors: { row: number; name: string; reason: string }[] = [];
    for (const r of records) {
      const name = (r.name ?? '').trim();
      if (!name) {
        errors.push({ row: r._row, name: '', reason: 'Name is missing' });
        continue;
      }
      const cat = r.category ? cats.find((c) => lc(c.name) === lc(r.category)) : undefined;
      if (r.category && !cat) {
        errors.push({ row: r._row, name, reason: `Unknown category "${r.category}"` });
        continue;
      }
      const tag = r.coa ? tags.find((t) => lc(t.name) === lc(r.coa) && (!cat || t.payCategoryId === cat.id)) : undefined;
      if (r.coa && !tag) {
        errors.push({ row: r._row, name, reason: `COA "${r.coa}" not found${cat ? ` in ${cat.name}` : ''}` });
        continue;
      }
      const vendor = r.vendor ? vendors.find((v) => lc(v.name) === lc(r.vendor)) : undefined;
      if (r.vendor && !vendor) {
        errors.push({ row: r._row, name, reason: `Unknown vendor "${r.vendor}"` });
        continue;
      }
      const price = r.unitPrice ? Number(r.unitPrice.replace(/[^\d.-]/g, '')) : 0;
      if (!Number.isFinite(price) || price < 0) {
        errors.push({ row: r._row, name, reason: 'Unit price must be a positive number' });
        continue;
      }
      const data = {
        description: r.description ?? null,
        payCategoryId: cat?.id ?? tags.find((t) => t.id === tag?.id)?.payCategoryId ?? null,
        coaTagId: tag?.id ?? null,
        vendorId: vendor?.id ?? null,
        unitName: r.unitName ?? null,
        unitAmount: price,
        isActive: parseCsvBool(r.active, true),
      };
      const existing = await this.prisma.stockExpense.findFirst({ where: { workspaceId, name: { equals: name, mode: 'insensitive' } } });
      if (existing) {
        await this.prisma.stockExpense.update({ where: { id: existing.id }, data });
        updated.push(name);
      } else {
        await this.prisma.stockExpense.create({ data: { ...data, workspaceId, name } });
        created.push(name);
      }
    }
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, 'Stock items CSV', { action: 'stock.csv_imported', created: created.length, updated: updated.length, errors: errors.length });
    return { created, updated, errors };
  }
}
