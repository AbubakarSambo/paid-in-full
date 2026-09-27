import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../../common';
import {
  AddAttachmentDto,
  AddCommentDto,
  CreateQueueItemDto,
  CsvImportDto,
  QueueQueryDto,
  UpdateQueueItemDto,
} from './dto';

function toNumber(val: Prisma.Decimal | number): number {
  return typeof val === 'number' ? val : Number(val);
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export interface CsvRowResult {
  row: number;
  success: boolean;
  error?: string;
  vendorName?: string;
}

/** Minimal RFC4180-ish CSV line splitter: handles quoted fields (with "" escapes) and commas
 * inside quotes. No external dependency, per the task's "no new npm dependency" constraint. */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result.map((v) => v.trim());
}

function parseCsv(text: string): string[][] {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
}

@Injectable()
export class QueueService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Soft budget check per the "Categorise and budget-check at entry" copy: looks up the Budget
   * row for this item's payCategory+costCenter+current month, sums existing QueueItem +
   * BatchItem spend already booked against it this month, and flags (does not block) if adding
   * this amount would exceed it.
   */
  private async computeBudgetFlag(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    payCategoryId: string | null | undefined,
    costCenterId: string | null | undefined,
    amount: number,
    excludeQueueItemId?: string,
  ): Promise<boolean> {
    if (!payCategoryId) return false;

    const now = new Date();
    const period = startOfMonth(now);
    const rangeStart = startOfMonth(now);
    const rangeEnd = endOfMonth(now);

    const budget = await tx.budget.findFirst({
      where: { workspaceId, payCategoryId, costCenterId: costCenterId ?? null, period },
    });
    if (!budget) return false;

    const queueSpend = await tx.queueItem.aggregate({
      where: {
        workspaceId,
        payCategoryId,
        costCenterId: costCenterId ?? null,
        status: { notIn: ['REJECTED'] },
        createdAt: { gte: rangeStart, lt: rangeEnd },
        ...(excludeQueueItemId && { id: { not: excludeQueueItemId } }),
      },
      _sum: { amount: true },
    });

    const batchSpend = await tx.batchItem.aggregate({
      where: {
        vendor: { workspaceId },
        queueItem: { payCategoryId, costCenterId: costCenterId ?? null },
        createdAt: { gte: rangeStart, lt: rangeEnd },
      },
      _sum: { grossAmount: true },
    });

    const alreadySpent = toNumber(queueSpend._sum.amount ?? 0) + toNumber(batchSpend._sum.grossAmount ?? 0);
    const projected = round2(alreadySpent + amount);

    return projected > toNumber(budget.amount);
  }

  async list(workspaceId: string, query: QueueQueryDto) {
    const { page = 1, limit = 20, status } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.QueueItemWhereInput = { workspaceId, ...(status && { status }) };

    const [items, total] = await Promise.all([
      this.prisma.queueItem.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { vendor: true, payCategory: true, costCenter: true, location: true },
      }),
      this.prisma.queueItem.count({ where }),
    ]);

    return paginate(items, total, page, limit);
  }

  async findOne(workspaceId: string, id: string) {
    const item = await this.prisma.queueItem.findFirst({
      where: { id, workspaceId },
      include: {
        vendor: true,
        payCategory: true,
        costCenter: true,
        location: true,
        attachments: true,
        comments: { include: { user: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!item) throw new NotFoundException('Queue item not found');
    return item;
  }

  async create(workspaceId: string, userId: string, dto: CreateQueueItemDto) {
    return this.prisma.$transaction(async (tx) => {
      const budgetFlag = await this.computeBudgetFlag(tx, workspaceId, dto.payCategoryId, dto.costCenterId, dto.amount);
      return tx.queueItem.create({
        data: {
          workspaceId,
          vendorId: dto.vendorId,
          payCategoryId: dto.payCategoryId,
          costCenterId: dto.costCenterId,
          locationId: dto.locationId,
          description: dto.description,
          amount: dto.amount,
          invoiceNumber: dto.invoiceNumber,
          invoiceDate: dto.invoiceDate,
          createdById: userId,
          status: budgetFlag ? 'BUDGET_FLAGGED' : 'PENDING',
          budgetFlag,
        },
      });
    });
  }

  async update(workspaceId: string, id: string, dto: UpdateQueueItemDto) {
    const existing = await this.findOne(workspaceId, id);
    if (existing.status === 'BATCHED') {
      throw new ConflictException('Cannot edit a queue item that has already been batched');
    }

    return this.prisma.$transaction(async (tx) => {
      const payCategoryId = dto.payCategoryId !== undefined ? dto.payCategoryId : existing.payCategoryId;
      const costCenterId = dto.costCenterId !== undefined ? dto.costCenterId : existing.costCenterId;
      const amount = dto.amount !== undefined ? dto.amount : toNumber(existing.amount);

      const budgetFlag = await this.computeBudgetFlag(tx, workspaceId, payCategoryId, costCenterId, amount, id);

      return tx.queueItem.update({
        where: { id },
        data: {
          ...(dto.vendorId !== undefined && { vendorId: dto.vendorId }),
          ...(dto.payCategoryId !== undefined && { payCategoryId: dto.payCategoryId }),
          ...(dto.costCenterId !== undefined && { costCenterId: dto.costCenterId }),
          ...(dto.locationId !== undefined && { locationId: dto.locationId }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.amount !== undefined && { amount: dto.amount }),
          ...(dto.invoiceNumber !== undefined && { invoiceNumber: dto.invoiceNumber }),
          ...(dto.invoiceDate !== undefined && { invoiceDate: dto.invoiceDate }),
          ...(dto.status !== undefined && { status: dto.status }),
          budgetFlag,
          ...(budgetFlag && existing.status === 'PENDING' && !dto.status && { status: 'BUDGET_FLAGGED' }),
        },
      });
    });
  }

  async remove(workspaceId: string, id: string) {
    const existing = await this.findOne(workspaceId, id);
    if (existing.status === 'BATCHED') {
      throw new ConflictException('Cannot delete a queue item that has already been batched');
    }
    await this.prisma.queueItem.delete({ where: { id } });
    return { success: true };
  }

  async addAttachment(workspaceId: string, queueItemId: string, userId: string, dto: AddAttachmentDto) {
    await this.findOne(workspaceId, queueItemId);
    return this.prisma.queueItemAttachment.create({
      data: { queueItemId, fileUrl: dto.fileUrl, fileName: dto.fileName, uploadedById: userId },
    });
  }

  async addComment(workspaceId: string, queueItemId: string, userId: string, dto: AddCommentDto) {
    await this.findOne(workspaceId, queueItemId);
    return this.prisma.queueItemComment.create({
      data: { queueItemId, userId, body: dto.body },
    });
  }

  async listComments(workspaceId: string, queueItemId: string) {
    await this.findOne(workspaceId, queueItemId);
    return this.prisma.queueItemComment.findMany({
      where: { queueItemId },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Bulk-imports queue items from raw CSV text (columns: vendorName,description,amount,
   * payCategory,invoiceNumber,invoiceDate). Vendors and pay categories are resolved/created by
   * name within the workspace. Rows are validated up front; only the valid subset is written,
   * inside one transaction — a DB failure on that transaction fails every still-pending row, but
   * a row that's invalid at parse time (bad amount, missing vendor name, etc.) is reported as a
   * per-row error without blocking the rest.
   */
  async importCsv(workspaceId: string, userId: string, dto: CsvImportDto) {
    const rows = parseCsv(dto.csv);
    if (rows.length === 0) {
      throw new BadRequestException('CSV is empty');
    }

    const header = rows[0].map((h) => h.toLowerCase());
    const expected = ['vendorname', 'description', 'amount', 'paycategory', 'invoicenumber', 'invoicedate'];
    const colIndex = (name: string) => header.indexOf(name);
    const missingRequired = ['vendorname', 'description', 'amount'].filter((c) => colIndex(c) === -1);
    if (missingRequired.length > 0) {
      throw new BadRequestException(`CSV header missing required column(s): ${missingRequired.join(', ')}`);
    }
    const hasHeader = expected.some((c) => header.includes(c));
    const dataRows = hasHeader ? rows.slice(1) : rows;

    const results: CsvRowResult[] = [];
    const validRows: { rowNum: number; vendorName: string; description: string; amount: number; payCategory?: string; invoiceNumber?: string; invoiceDate?: Date }[] = [];

    dataRows.forEach((cols, idx) => {
      const rowNum = idx + (hasHeader ? 2 : 1);
      const vendorName = cols[colIndex('vendorname')]?.trim();
      const description = cols[colIndex('description')]?.trim();
      const amountRaw = cols[colIndex('amount')]?.trim();
      const payCategory = colIndex('paycategory') >= 0 ? cols[colIndex('paycategory')]?.trim() : undefined;
      const invoiceNumber = colIndex('invoicenumber') >= 0 ? cols[colIndex('invoicenumber')]?.trim() : undefined;
      const invoiceDateRaw = colIndex('invoicedate') >= 0 ? cols[colIndex('invoicedate')]?.trim() : undefined;

      if (!vendorName) {
        results.push({ row: rowNum, success: false, error: 'Missing vendorName' });
        return;
      }
      if (!description) {
        results.push({ row: rowNum, success: false, error: 'Missing description', vendorName });
        return;
      }
      const amount = Number(amountRaw);
      if (!amountRaw || Number.isNaN(amount) || amount <= 0) {
        results.push({ row: rowNum, success: false, error: `Invalid amount "${amountRaw}"`, vendorName });
        return;
      }
      let invoiceDate: Date | undefined;
      if (invoiceDateRaw) {
        const parsed = new Date(invoiceDateRaw);
        if (Number.isNaN(parsed.getTime())) {
          results.push({ row: rowNum, success: false, error: `Invalid invoiceDate "${invoiceDateRaw}"`, vendorName });
          return;
        }
        invoiceDate = parsed;
      }

      validRows.push({
        rowNum,
        vendorName,
        description,
        amount,
        payCategory: payCategory || undefined,
        invoiceNumber: invoiceNumber || undefined,
        invoiceDate,
      });
    });

    if (validRows.length > 0) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const vendorCache = new Map<string, string>();
          const categoryCache = new Map<string, string>();

          for (const row of validRows) {
            let vendorId = vendorCache.get(row.vendorName.toLowerCase());
            if (!vendorId) {
              const vendor = await tx.vendor.upsert({
                where: { workspaceId_name: { workspaceId, name: row.vendorName } },
                update: {},
                create: { workspaceId, name: row.vendorName },
              });
              vendorId = vendor.id;
              vendorCache.set(row.vendorName.toLowerCase(), vendorId);
            }

            let payCategoryId: string | undefined;
            if (row.payCategory) {
              payCategoryId = categoryCache.get(row.payCategory.toLowerCase());
              if (!payCategoryId) {
                const category = await tx.payCategory.upsert({
                  where: { workspaceId_name: { workspaceId, name: row.payCategory } },
                  update: {},
                  create: { workspaceId, name: row.payCategory },
                });
                payCategoryId = category.id;
                categoryCache.set(row.payCategory.toLowerCase(), payCategoryId);
              }
            }

            const budgetFlag = await this.computeBudgetFlag(tx, workspaceId, payCategoryId, undefined, row.amount);

            await tx.queueItem.create({
              data: {
                workspaceId,
                vendorId,
                payCategoryId,
                description: row.description,
                amount: row.amount,
                invoiceNumber: row.invoiceNumber,
                invoiceDate: row.invoiceDate,
                createdById: userId,
                status: budgetFlag ? 'BUDGET_FLAGGED' : 'PENDING',
                budgetFlag,
              },
            });
          }
        });

        // Only recorded once the whole transaction has actually committed — pushing per-row
        // success markers while inside the transaction would leave stale "success" entries if a
        // later row in the same transaction caused a rollback.
        for (const row of validRows) {
          results.push({ row: row.rowNum, success: true, vendorName: row.vendorName });
        }
      } catch (error) {
        // The whole write transaction failed (e.g. a DB constraint) — every row that had passed
        // validation is reported as failed too, since nothing was actually committed.
        for (const row of validRows) {
          results.push({
            row: row.rowNum,
            success: false,
            error: `Transaction failed: ${error instanceof Error ? error.message : 'unknown error'}`,
            vendorName: row.vendorName,
          });
        }
      }
    }

    results.sort((a, b) => a.row - b.row);
    return {
      totalRows: dataRows.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }
}
