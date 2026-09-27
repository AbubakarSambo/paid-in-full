import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { QueueItemStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryBudgetsDto, UpsertBudgetDto } from './dto';
import { looksLikeHeaderRow, parseAmount, parseCsv } from './budgets-csv.util';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function parsePeriod(period: string): Date {
  const [yearStr, monthStr] = period.split('-');
  return new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
}

function monthRange(periodDate: Date): { start: Date; end: Date } {
  const start = periodDate;
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, end };
}

export interface BudgetImportRowResult {
  row: number;
  payCategory: string | null;
  costCenter: string | null;
  period: string | null;
  amount?: number;
  success: boolean;
  budgetId?: string;
  error?: string;
}

export interface BudgetVarianceRow {
  payCategory: string;
  costCenter: string | null;
  budgeted: number;
  actual: number;
  variance: number;
  variancePercent: number | null;
}

@Injectable()
export class BudgetsService {
  constructor(private prisma: PrismaService) {}

  async findAll(workspaceId: string, query: QueryBudgetsDto) {
    return this.prisma.budget.findMany({
      where: {
        workspaceId,
        ...(query.period && { period: parsePeriod(query.period) }),
        ...(query.payCategoryId && { payCategoryId: query.payCategoryId }),
        ...(query.costCenterId && { costCenterId: query.costCenterId }),
      },
      include: { payCategory: true, costCenter: true },
      orderBy: [{ period: 'desc' }, { payCategory: { name: 'asc' } }],
    });
  }

  async upsert(workspaceId: string, dto: UpsertBudgetDto) {
    const payCategory = await this.prisma.payCategory.findFirst({
      where: { id: dto.payCategoryId, workspaceId },
    });
    if (!payCategory) {
      throw new NotFoundException('Pay category not found');
    }

    let costCenterId: string | null = null;
    if (dto.costCenterId) {
      const costCenter = await this.prisma.costCenter.findFirst({
        where: { id: dto.costCenterId, workspaceId },
      });
      if (!costCenter) {
        throw new NotFoundException('Cost center not found');
      }
      costCenterId = costCenter.id;
    }

    const period = parsePeriod(dto.period);

    // Prisma's compound-unique lookup type requires costCenterId: string (not string | null),
    // since Postgres treats NULLs as distinct within a unique constraint — so upsert() can only
    // be used directly when costCenterId is set. When it's null, fall back to a manual
    // find-then-create/update against the same (workspaceId, payCategoryId, costCenterId: null,
    // period) tuple.
    if (costCenterId) {
      return this.prisma.budget.upsert({
        where: {
          workspaceId_payCategoryId_costCenterId_period: {
            workspaceId,
            payCategoryId: dto.payCategoryId,
            costCenterId,
            period,
          },
        },
        create: {
          workspaceId,
          payCategoryId: dto.payCategoryId,
          costCenterId,
          period,
          amount: dto.amount,
        },
        update: { amount: dto.amount },
        include: { payCategory: true, costCenter: true },
      });
    }

    const existing = await this.prisma.budget.findFirst({
      where: { workspaceId, payCategoryId: dto.payCategoryId, costCenterId: null, period },
    });

    if (existing) {
      return this.prisma.budget.update({
        where: { id: existing.id },
        data: { amount: dto.amount },
        include: { payCategory: true, costCenter: true },
      });
    }

    return this.prisma.budget.create({
      data: {
        workspaceId,
        payCategoryId: dto.payCategoryId,
        costCenterId: null,
        period,
        amount: dto.amount,
      },
      include: { payCategory: true, costCenter: true },
    });
  }

  async remove(workspaceId: string, id: string) {
    const existing = await this.prisma.budget.findFirst({ where: { id, workspaceId } });
    if (!existing) {
      throw new NotFoundException('Budget not found');
    }

    await this.prisma.budget.delete({ where: { id } });

    return { success: true };
  }

  async importCsv(workspaceId: string, csv: string): Promise<{
    imported: number;
    failed: number;
    results: BudgetImportRowResult[];
  }> {
    const rows = parseCsv(csv);
    if (rows.length === 0) {
      throw new BadRequestException('CSV is empty');
    }

    const dataRows = looksLikeHeaderRow(rows[0]) ? rows.slice(1) : rows;

    const results = await this.prisma.$transaction(async (tx) => {
      const rowResults: BudgetImportRowResult[] = [];

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const payCategoryName = (row[0] ?? '').trim();
        const costCenterName = (row[1] ?? '').trim();
        const periodRaw = (row[2] ?? '').trim();
        const amountRaw = row[3];

        try {
          if (!payCategoryName) throw new Error('payCategory is required');
          if (!PERIOD_PATTERN.test(periodRaw)) {
            throw new Error('period must be in YYYY-MM format');
          }
          const amount = parseAmount(amountRaw);
          if (amount === null || amount < 0) {
            throw new Error('amount is invalid');
          }

          let payCategory = await tx.payCategory.findFirst({
            where: { workspaceId, name: { equals: payCategoryName, mode: 'insensitive' } },
          });
          if (!payCategory) {
            payCategory = await tx.payCategory.create({
              data: { workspaceId, name: payCategoryName },
            });
          }

          let costCenterId: string | null = null;
          if (costCenterName) {
            const costCenter = await tx.costCenter.findFirst({
              where: { workspaceId, name: { equals: costCenterName, mode: 'insensitive' } },
            });
            if (!costCenter) {
              throw new Error(`cost center "${costCenterName}" not found`);
            }
            costCenterId = costCenter.id;
          }

          const period = parsePeriod(periodRaw);
          const existing = await tx.budget.findFirst({
            where: { workspaceId, payCategoryId: payCategory.id, costCenterId, period },
          });

          const budget = existing
            ? await tx.budget.update({ where: { id: existing.id }, data: { amount } })
            : await tx.budget.create({
                data: { workspaceId, payCategoryId: payCategory.id, costCenterId, period, amount },
              });

          rowResults.push({
            row: i + 1,
            payCategory: payCategoryName,
            costCenter: costCenterName || null,
            period: periodRaw,
            amount,
            success: true,
            budgetId: budget.id,
          });
        } catch (error) {
          rowResults.push({
            row: i + 1,
            payCategory: payCategoryName || null,
            costCenter: costCenterName || null,
            period: periodRaw || null,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      return rowResults;
    });

    return {
      imported: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  async getVarianceReport(workspaceId: string, period: string): Promise<BudgetVarianceRow[]> {
    const periodDate = parsePeriod(period);
    const { start, end } = monthRange(periodDate);

    const budgets = await this.prisma.budget.findMany({
      where: { workspaceId, period: periodDate },
      include: { payCategory: true, costCenter: true },
    });

    const rows: BudgetVarianceRow[] = await Promise.all(
      budgets.map(async (budget) => {
        const [queueItemAgg, batchItemAgg] = await Promise.all([
          this.prisma.queueItem.aggregate({
            where: {
              workspaceId,
              payCategoryId: budget.payCategoryId,
              costCenterId: budget.costCenterId,
              status: { not: QueueItemStatus.REJECTED },
              createdAt: { gte: start, lt: end },
            },
            _sum: { amount: true },
          }),
          this.prisma.batchItem.aggregate({
            where: {
              queueItem: {
                workspaceId,
                payCategoryId: budget.payCategoryId,
                costCenterId: budget.costCenterId,
              },
              batch: { createdAt: { gte: start, lt: end } },
            },
            _sum: { grossAmount: true },
          }),
        ]);

        const budgeted = Number(budget.amount);
        const actual =
          Number(queueItemAgg._sum.amount ?? 0) + Number(batchItemAgg._sum.grossAmount ?? 0);
        const variance = actual - budgeted;
        const variancePercent = budgeted !== 0 ? (variance / budgeted) * 100 : null;

        return {
          payCategory: budget.payCategory.name,
          costCenter: budget.costCenter?.name ?? null,
          budgeted,
          actual,
          variance,
          variancePercent,
        };
      }),
    );

    return rows.sort((a, b) => b.variance - a.variance);
  }
}
