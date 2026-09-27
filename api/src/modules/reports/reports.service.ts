import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SpendByCategoryRow {
  payCategoryId: string | null;
  payCategory: string;
  total: number;
}

export interface SpendByVendorRow {
  vendorId: string;
  vendor: string;
  total: number;
}

export interface MonthlyGridRow {
  payCategoryId: string | null;
  payCategory: string;
  months: number[]; // index 0 = January ... 11 = December
  total: number;
}

export interface MonthlyGridResult {
  year: number;
  rows: MonthlyGridRow[];
  monthlyTotals: number[];
  grandTotal: number;
}

export interface ExportRow {
  date: Date;
  vendor: string;
  category: string;
  costCenter: string;
  grossAmount: number;
  whtAmount: number;
  netAmount: number;
}

/**
 * Aggregation is over BatchItem (already-disbursed spend), scoped to the batch's workspace and
 * restricted to batches whose status is DISBURSED — i.e. money that has actually left the wallet.
 * PayCategory/CostCenter live on the originating QueueItem, not on BatchItem itself, so every
 * query joins through `queueItem`. Not-yet-batched spend sitting in the queue (QueueItem rows with
 * no BatchItem yet) is intentionally excluded — these reports describe realized spend, not
 * pipeline/forecast spend.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(workspaceId: string, startDate?: Date, endDate?: Date): Prisma.BatchItemWhereInput {
    const where: Prisma.BatchItemWhereInput = {
      batch: { workspaceId, status: 'DISBURSED' },
    };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Prisma.DateTimeFilter).gte = startDate;
      if (endDate) (where.createdAt as Prisma.DateTimeFilter).lte = endDate;
    }
    return where;
  }

  async spendByCategory(workspaceId: string, startDate?: Date, endDate?: Date): Promise<SpendByCategoryRow[]> {
    const items = await this.prisma.batchItem.findMany({
      where: this.buildWhere(workspaceId, startDate, endDate),
      select: {
        grossAmount: true,
        queueItem: { select: { payCategory: { select: { id: true, name: true } } } },
      },
    });

    const totals = new Map<string, SpendByCategoryRow>();
    for (const item of items) {
      const cat = item.queueItem?.payCategory;
      const key = cat?.id ?? '__uncategorized__';
      const existing = totals.get(key);
      const amount = Number(item.grossAmount);
      if (existing) {
        existing.total += amount;
      } else {
        totals.set(key, {
          payCategoryId: cat?.id ?? null,
          payCategory: cat?.name ?? 'Uncategorized',
          total: amount,
        });
      }
    }

    return Array.from(totals.values()).sort((a, b) => b.total - a.total);
  }

  async spendByVendor(
    workspaceId: string,
    startDate?: Date,
    endDate?: Date,
    limit = 10,
  ): Promise<SpendByVendorRow[]> {
    const items = await this.prisma.batchItem.findMany({
      where: this.buildWhere(workspaceId, startDate, endDate),
      select: {
        grossAmount: true,
        vendor: { select: { id: true, name: true } },
      },
    });

    const totals = new Map<string, SpendByVendorRow>();
    for (const item of items) {
      const key = item.vendor.id;
      const existing = totals.get(key);
      const amount = Number(item.grossAmount);
      if (existing) {
        existing.total += amount;
      } else {
        totals.set(key, { vendorId: item.vendor.id, vendor: item.vendor.name, total: amount });
      }
    }

    return Array.from(totals.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }

  async monthlyGrid(workspaceId: string, year: number): Promise<MonthlyGridResult> {
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const items = await this.prisma.batchItem.findMany({
      where: this.buildWhere(workspaceId, startDate, endDate),
      select: {
        grossAmount: true,
        createdAt: true,
        queueItem: { select: { payCategory: { select: { id: true, name: true } } } },
      },
    });

    const rowsByCategory = new Map<string, MonthlyGridRow>();
    const monthlyTotals = new Array(12).fill(0);
    let grandTotal = 0;

    for (const item of items) {
      const cat = item.queueItem?.payCategory;
      const key = cat?.id ?? '__uncategorized__';
      const month = item.createdAt.getUTCMonth(); // 0-11
      const amount = Number(item.grossAmount);

      let row = rowsByCategory.get(key);
      if (!row) {
        row = {
          payCategoryId: cat?.id ?? null,
          payCategory: cat?.name ?? 'Uncategorized',
          months: new Array(12).fill(0),
          total: 0,
        };
        rowsByCategory.set(key, row);
      }
      row.months[month] += amount;
      row.total += amount;
      monthlyTotals[month] += amount;
      grandTotal += amount;
    }

    const rows = Array.from(rowsByCategory.values()).sort((a, b) => b.total - a.total);

    return { year, rows, monthlyTotals, grandTotal };
  }

  async exportRows(workspaceId: string, startDate?: Date, endDate?: Date): Promise<ExportRow[]> {
    const items = await this.prisma.batchItem.findMany({
      where: this.buildWhere(workspaceId, startDate, endDate),
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true,
        grossAmount: true,
        whtAmount: true,
        netAmount: true,
        vendor: { select: { name: true } },
        queueItem: {
          select: {
            payCategory: { select: { name: true } },
            costCenter: { select: { name: true } },
          },
        },
      },
    });

    return items.map((item) => ({
      date: item.createdAt,
      vendor: item.vendor.name,
      category: item.queueItem?.payCategory?.name ?? 'Uncategorized',
      costCenter: item.queueItem?.costCenter?.name ?? '',
      grossAmount: Number(item.grossAmount),
      whtAmount: Number(item.whtAmount),
      netAmount: Number(item.netAmount),
    }));
  }
}
