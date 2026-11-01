import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CoaTag, PayCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, AuditActor } from '../platform/audit-log.service';
import { AUDIT_ACTIONS } from '../../common/audit-actions';
import {
  BudgetImportCommitDto,
  BudgetImportPreviewDto,
  BudgetOverviewQueryDto,
  CopyPreviousBudgetsDto,
  CreateBudgetTagDto,
  QueryBudgetsDto,
  UpsertBudgetDto,
  VarianceQueryDto,
} from './dto';
import { parseAmount, parseCsv } from './budgets-csv.util';
import { BATCH_SPEND_WHERE, computeSpend } from './budget-spend.util';

/**
 * Spec §5.7 Budgets: monthly caps per (period month × Business Unit × COA tag), only for COA tags
 * in categories with includeInBudgets. Spend = batch lines + pending queue items by P&L period for
 * that BU, excluding failed/cancelled payouts (see budget-spend.util.ts).
 */

type DbClient = Prisma.TransactionClient | PrismaService;

const BUDGET_INCLUDE = {
  coaTag: { include: { payCategory: { select: { id: true, name: true, color: true } } } },
  costCenter: true,
} satisfies Prisma.BudgetInclude;

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function prevMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function utcToday(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== d) throw new BadRequestException(`Invalid date "${s}"`);
  return date;
}

function daysInMonth(year: number, monthIdx: number): number {
  return new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
}

/** Normalise a label for fuzzy matching: lowercase alphanumerics only. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface VarianceLine {
  source: 'batch' | 'queue';
  id: string;
  date: Date;
  vendorName: string | null;
  description: string;
  total: number;
  pnlPeriod: string | null;
  batchRef?: string;
  status: string;
}

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // ─── helpers ───────────────────────────────────────────────────────────

  /** Active COA tags whose category is active and has includeInBudgets. */
  private budgetedTags(client: DbClient, workspaceId: string) {
    return client.coaTag.findMany({
      where: { workspaceId, isActive: true, payCategory: { includeInBudgets: true, isActive: true } },
      include: { payCategory: { select: { id: true, name: true, color: true, sortOrder: true } } },
      orderBy: [{ payCategory: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  private async assertBudgetedTag(client: DbClient, workspaceId: string, coaTagId: string) {
    const tag = await client.coaTag.findFirst({ where: { id: coaTagId, workspaceId }, include: { payCategory: true } });
    if (!tag) throw new NotFoundException('COA tag not found');
    if (!tag.payCategory.includeInBudgets) {
      throw new BadRequestException(`"${tag.payCategory.name}" is not a budgeted category — enable its budget toggle in Settings first`);
    }
    return tag;
  }

  /** undefined → all BUs, 'none'/'' → null (workspace-wide), uuid → validated BU id. */
  private async resolveBu(workspaceId: string, raw: string | undefined): Promise<string | null | undefined> {
    if (raw === undefined) return undefined;
    if (raw === '' || raw === 'none' || raw === 'null') return null;
    const bu = await this.prisma.costCenter.findFirst({ where: { id: raw, workspaceId } });
    if (!bu) throw new NotFoundException('Business Unit not found');
    return bu.id;
  }

  private async firstBudgetedCategory(client: DbClient, workspaceId: string, payCategoryId?: string): Promise<PayCategory> {
    if (payCategoryId) {
      const cat = await client.payCategory.findFirst({ where: { id: payCategoryId, workspaceId } });
      if (!cat) throw new NotFoundException('Payment category not found');
      if (!cat.includeInBudgets) throw new BadRequestException(`"${cat.name}" is not a budgeted category`);
      return cat;
    }
    const cat = await client.payCategory.findFirst({
      where: { workspaceId, includeInBudgets: true, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (!cat) throw new BadRequestException('No payment category is set to be included in budgets');
    return cat;
  }

  private async findOrCreateTag(client: DbClient, workspaceId: string, name: string, payCategoryId?: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Tag name is required');
    const category = await this.firstBudgetedCategory(client, workspaceId, payCategoryId);
    const existing = await client.coaTag.findFirst({
      where: { workspaceId, payCategoryId: category.id, name: { equals: trimmed, mode: 'insensitive' } },
    });
    if (existing) {
      if (!existing.isActive) return { tag: await client.coaTag.update({ where: { id: existing.id }, data: { isActive: true } }), created: false };
      return { tag: existing, created: false };
    }
    const max = await client.coaTag.aggregate({ where: { payCategoryId: category.id }, _max: { sortOrder: true } });
    const tag = await client.coaTag.create({
      data: { workspaceId, payCategoryId: category.id, name: trimmed, sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });
    return { tag, created: true };
  }

  private async writeBudget(
    client: DbClient,
    workspaceId: string,
    coaTagId: string,
    costCenterId: string | null,
    periodMonth: string,
    amount: number,
  ) {
    // NULL BU is distinct in the unique index, so find-then-write instead of upsert.
    const existing = await client.budget.findFirst({ where: { workspaceId, coaTagId, costCenterId, periodMonth } });
    if (existing) {
      const budget = await client.budget.update({ where: { id: existing.id }, data: { monthlyAmount: amount }, include: BUDGET_INCLUDE });
      return { budget, previous: Number(existing.monthlyAmount) };
    }
    const budget = await client.budget.create({
      data: { workspaceId, coaTagId, costCenterId, periodMonth, monthlyAmount: amount },
      include: BUDGET_INCLUDE,
    });
    return { budget, previous: null as number | null };
  }

  // ─── list / overview ───────────────────────────────────────────────────

  async findAll(workspaceId: string, query: QueryBudgetsDto) {
    return this.prisma.budget.findMany({
      where: {
        workspaceId,
        ...(query.period && { periodMonth: query.period }),
        ...(query.coaTagId && { coaTagId: query.coaTagId }),
        ...(query.costCenterId && { costCenterId: query.costCenterId }),
      },
      include: BUDGET_INCLUDE,
      orderBy: [{ periodMonth: 'desc' }, { coaTag: { name: 'asc' } }],
    });
  }

  /** Budgets screen: one row per budgeted COA tag with cap, spend, remaining and KPIs. */
  async overview(workspaceId: string, query: BudgetOverviewQueryDto) {
    const costCenterId = await this.resolveBu(workspaceId, query.costCenterId);
    const [tags, budgets, businessUnits] = await Promise.all([
      this.budgetedTags(this.prisma, workspaceId),
      this.prisma.budget.findMany({
        where: {
          workspaceId,
          periodMonth: query.period,
          ...(costCenterId !== undefined && { costCenterId }),
        },
      }),
      this.prisma.costCenter.findMany({
        where: { workspaceId, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, code: true },
      }),
    ]);

    const spendMap = await computeSpend(this.prisma, workspaceId, {
      periods: [query.period],
      coaTagIds: tags.map((t) => t.id),
      costCenterId,
    });
    const spentByTag = new Map<string, number>();
    for (const [key, amount] of spendMap) {
      const coaTagId = key.split('|')[2];
      spentByTag.set(coaTagId, (spentByTag.get(coaTagId) ?? 0) + amount);
    }

    const capByTag = new Map<string, { cap: number; budgetId: string | null }>();
    for (const b of budgets) {
      const cur = capByTag.get(b.coaTagId);
      // All-BU view aggregates caps; budgetId is only meaningful for a single-BU view.
      capByTag.set(b.coaTagId, {
        cap: round2((cur?.cap ?? 0) + Number(b.monthlyAmount)),
        budgetId: costCenterId === undefined ? null : b.id,
      });
    }

    const rows = tags.map((t) => {
      const capInfo = capByTag.get(t.id);
      const cap = capInfo ? capInfo.cap : null;
      const spent = round2(spentByTag.get(t.id) ?? 0);
      return {
        coaTagId: t.id,
        name: t.name,
        payCategory: { id: t.payCategory.id, name: t.payCategory.name, color: t.payCategory.color },
        cap,
        budgetId: capInfo?.budgetId ?? null,
        spent,
        remaining: cap === null ? null : round2(cap - spent),
        pct: cap ? Math.round((spent / cap) * 1000) / 10 : null,
        over: cap !== null && spent > cap ? round2(spent - cap) : 0,
      };
    });

    const totalCap = round2(rows.reduce((s, r) => s + (r.cap ?? 0), 0));
    const spent = round2(rows.reduce((s, r) => s + r.spent, 0));
    return {
      period: query.period,
      costCenterId: costCenterId === undefined ? 'all' : costCenterId,
      kpis: { totalCap, spent, remaining: round2(totalCap - spent) },
      rows,
      businessUnits,
    };
  }

  // ─── writes ────────────────────────────────────────────────────────────

  async upsert(workspaceId: string, actor: AuditActor, dto: UpsertBudgetDto) {
    const tag = await this.assertBudgetedTag(this.prisma, workspaceId, dto.coaTagId);
    let costCenterId: string | null = null;
    if (dto.costCenterId) {
      const bu = await this.prisma.costCenter.findFirst({ where: { id: dto.costCenterId, workspaceId } });
      if (!bu) throw new NotFoundException('Business Unit not found');
      costCenterId = bu.id;
    }
    const { budget, previous } = await this.writeBudget(this.prisma, workspaceId, tag.id, costCenterId, dto.period, dto.amount);
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.BUDGET_UPDATED, `${tag.name} · ${dto.period}`, {
      coaTagId: tag.id,
      costCenterId,
      period: dto.period,
      oldAmount: previous,
      newAmount: dto.amount,
    }, { type: 'budget', id: budget.id });
    return budget;
  }

  async remove(workspaceId: string, actor: AuditActor, id: string) {
    const existing = await this.prisma.budget.findFirst({ where: { id, workspaceId }, include: { coaTag: true } });
    if (!existing) throw new NotFoundException('Budget not found');
    await this.prisma.budget.delete({ where: { id } });
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.BUDGET_UPDATED, `${existing.coaTag.name} · ${existing.periodMonth}`, {
      coaTagId: existing.coaTagId,
      costCenterId: existing.costCenterId,
      period: existing.periodMonth,
      oldAmount: Number(existing.monthlyAmount),
      newAmount: null,
      removed: true,
    }, { type: 'budget', id });
    return { success: true };
  }

  async copyPrevious(workspaceId: string, actor: AuditActor, dto: CopyPreviousBudgetsDto) {
    const from = prevMonth(dto.period);
    if (dto.costCenterId) {
      const bu = await this.prisma.costCenter.findFirst({ where: { id: dto.costCenterId, workspaceId } });
      if (!bu) throw new NotFoundException('Business Unit not found');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const source = await tx.budget.findMany({
        where: {
          workspaceId,
          periodMonth: from,
          ...(dto.costCenterId && { costCenterId: dto.costCenterId }),
          coaTag: { payCategory: { includeInBudgets: true } },
        },
      });
      let copied = 0;
      let skipped = 0;
      for (const b of source) {
        const existing = await tx.budget.findFirst({
          where: { workspaceId, periodMonth: dto.period, costCenterId: b.costCenterId, coaTagId: b.coaTagId },
        });
        if (existing && !dto.overwrite) {
          skipped++;
          continue;
        }
        await this.writeBudget(tx, workspaceId, b.coaTagId, b.costCenterId, dto.period, Number(b.monthlyAmount));
        copied++;
      }
      return { copied, skipped, from, to: dto.period };
    });
    if (result.copied > 0) {
      await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.BUDGET_UPDATED, `Copied ${from} → ${dto.period}`, {
        ...result,
        costCenterId: dto.costCenterId ?? null,
        overwrite: !!dto.overwrite,
      });
    }
    return result;
  }

  async createTag(workspaceId: string, dto: CreateBudgetTagDto) {
    const { tag, created } = await this.findOrCreateTag(this.prisma, workspaceId, dto.name, dto.payCategoryId);
    return { ...tag, created };
  }

  // ─── variance report ───────────────────────────────────────────────────

  private resolveRange(query: VarianceQueryDto): { from: Date; to: Date } {
    const today = utcToday();
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    switch (query.preset ?? 'this_month') {
      case 'mtd':
        return { from: new Date(Date.UTC(y, m, 1)), to: today };
      case 'this_month':
        return { from: new Date(Date.UTC(y, m, 1)), to: new Date(Date.UTC(y, m + 1, 0)) };
      case 'last_month':
        return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) };
      case 'last_30':
        return { from: new Date(today.getTime() - 29 * DAY_MS), to: today };
      case 'last_90':
        return { from: new Date(today.getTime() - 89 * DAY_MS), to: today };
      case 'ytd':
        return { from: new Date(Date.UTC(y, 0, 1)), to: today };
      case 'custom': {
        if (!query.from || !query.to) throw new BadRequestException('from and to are required for a custom range');
        const from = parseYmd(query.from);
        const to = parseYmd(query.to);
        if (to < from) throw new BadRequestException('to must be on or after from');
        if ((to.getTime() - from.getTime()) / DAY_MS > 3660) throw new BadRequestException('Range is too long');
        return { from, to };
      }
    }
  }

  /**
   * Budget for a range = Σ over overlapping months of monthlyAmount × (days of the month inside the
   * range / days in that month). Actuals: pnlPeriod is month-granular, so a line counts in full
   * when its P&L month is one of the months the range touches (it is NOT pro-rated by day).
   */
  async variance(workspaceId: string, query: VarianceQueryDto) {
    const { from, to } = this.resolveRange(query);
    const costCenterId = await this.resolveBu(workspaceId, query.costCenterId);
    const days = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;

    // Months touched by the range, with the fraction of each month inside it.
    const months: { period: string; fraction: number }[] = [];
    let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    while (cursor <= to) {
      const yy = cursor.getUTCFullYear();
      const mi = cursor.getUTCMonth();
      const dim = daysInMonth(yy, mi);
      const monthStart = cursor;
      const monthEnd = new Date(Date.UTC(yy, mi, dim));
      const start = from > monthStart ? from : monthStart;
      const end = to < monthEnd ? to : monthEnd;
      const inside = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
      months.push({ period: `${yy}-${String(mi + 1).padStart(2, '0')}`, fraction: inside / dim });
      cursor = new Date(Date.UTC(yy, mi + 1, 1));
    }
    const periods = months.map((x) => x.period);
    const fractionOf = new Map(months.map((x) => [x.period, x.fraction]));

    const tags = await this.budgetedTags(this.prisma, workspaceId);
    const tagIds = tags.map((t) => t.id);
    const buWhere = costCenterId !== undefined ? { costCenterId } : {};

    const [budgets, queueLines, batchLines] = await Promise.all([
      this.prisma.budget.findMany({ where: { workspaceId, periodMonth: { in: periods }, coaTagId: { in: tagIds }, ...buWhere } }),
      this.prisma.queueItem.findMany({
        where: { workspaceId, status: 'PENDING', pnlPeriod: { in: periods }, coaTagId: { in: tagIds }, ...buWhere },
        select: { id: true, date: true, vendorName: true, description: true, total: true, pnlPeriod: true, coaTagId: true, status: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.batchItem.findMany({
        where: {
          batch: { workspaceId, payoutStatus: { not: 'CANCELLED' } },
          ...BATCH_SPEND_WHERE,
          pnlPeriod: { in: periods },
          coaTagId: { in: tagIds },
          ...buWhere,
        },
        select: {
          id: true, date: true, vendorName: true, description: true, total: true, pnlPeriod: true, coaTagId: true,
          payoutStatus: true, batch: { select: { batchRef: true } },
        },
        orderBy: { date: 'asc' },
      }),
    ]);

    const budgetByTag = new Map<string, number>();
    for (const b of budgets) {
      const prorated = Number(b.monthlyAmount) * (fractionOf.get(b.periodMonth) ?? 0);
      budgetByTag.set(b.coaTagId, (budgetByTag.get(b.coaTagId) ?? 0) + prorated);
    }
    const linesByTag = new Map<string, VarianceLine[]>();
    const push = (coaTagId: string | null, line: VarianceLine) => {
      if (!coaTagId) return;
      const arr = linesByTag.get(coaTagId) ?? [];
      arr.push(line);
      linesByTag.set(coaTagId, arr);
    };
    for (const q of queueLines) {
      push(q.coaTagId, {
        source: 'queue', id: q.id, date: q.date, vendorName: q.vendorName, description: q.description,
        total: Number(q.total), pnlPeriod: q.pnlPeriod, status: q.status,
      });
    }
    for (const b of batchLines) {
      push(b.coaTagId, {
        source: 'batch', id: b.id, date: b.date, vendorName: b.vendorName, description: b.description,
        total: Number(b.total), pnlPeriod: b.pnlPeriod, batchRef: b.batch.batchRef, status: b.payoutStatus,
      });
    }

    const rows = tags
      .map((t) => {
        const budget = round2(budgetByTag.get(t.id) ?? 0);
        const lines = linesByTag.get(t.id) ?? [];
        const actual = round2(lines.reduce((s, l) => s + l.total, 0));
        const variance = round2(budget - actual);
        return {
          coaTagId: t.id,
          coaTag: t.name,
          payCategory: { id: t.payCategory.id, name: t.payCategory.name, color: t.payCategory.color },
          budget,
          actual,
          variance,
          variancePct: budget ? Math.round((variance / budget) * 1000) / 10 : null,
          lines,
        };
      })
      .filter((r) => r.budget > 0 || r.actual > 0)
      .sort((a, b) => a.variance - b.variance);

    const budget = round2(rows.reduce((s, r) => s + r.budget, 0));
    const actual = round2(rows.reduce((s, r) => s + r.actual, 0));
    const variance = round2(budget - actual);
    return {
      summary: {
        budget,
        actual,
        variance,
        variancePct: budget ? Math.round((variance / budget) * 1000) / 10 : null,
        from: ymd(from),
        to: ymd(to),
        days,
        preset: query.preset ?? 'this_month',
        costCenterId: costCenterId === undefined ? 'all' : costCenterId,
      },
      rows,
    };
  }

  // ─── import wizard ─────────────────────────────────────────────────────

  async importPreview(workspaceId: string, dto: BudgetImportPreviewDto) {
    const parsed = parseCsv(dto.csv).map((r) => r.map((c) => (c ?? '').trim()));
    if (parsed.length === 0) throw new BadRequestException('CSV is empty');
    const width = Math.max(...parsed.map((r) => r.length));
    const isNumeric = (v: string) => !!v && !/[a-z]/i.test(v) && parseAmount(v) !== null;

    // Header detection: first row has no numeric cells while a later row does.
    const hasHeader =
      dto.hasHeader ??
      (!parsed[0].some(isNumeric) && parsed.slice(1).some((r) => r.some(isNumeric)));
    const headers = hasHeader ? parsed[0] : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    const dataRows = hasHeader ? parsed.slice(1) : parsed;

    const columns = Array.from({ length: width }, (_, i) => {
      const values = dataRows.map((r) => r[i] ?? '').filter((v) => v !== '');
      const numeric = values.filter(isNumeric).length;
      return {
        index: i,
        header: headers[i] ?? `Column ${i + 1}`,
        numericRatio: values.length ? numeric / values.length : 0,
        textRatio: values.length ? (values.length - numeric) / values.length : 0,
        sample: values.slice(0, 3),
      };
    });

    const amountColumn = dto.amountColumn ?? columns.find((c) => c.numericRatio >= 0.6)?.index ?? null;
    const labelColumn =
      dto.labelColumn ?? columns.find((c) => c.index !== amountColumn && c.textRatio >= 0.5)?.index ?? null;
    if (amountColumn === null || labelColumn === null) {
      return { headers, hasHeader, columns, labelColumn, amountColumn, rows: [] };
    }
    if (amountColumn >= width || labelColumn >= width) throw new BadRequestException('Column index out of range');

    const tags = await this.budgetedTags(this.prisma, workspaceId);
    const match = (label: string): { tag: CoaTag | null; match: 'exact' | 'fuzzy' | 'none' } => {
      const lower = label.toLowerCase();
      const n = norm(label);
      const exact = tags.find((t) => t.name.toLowerCase() === lower || (n && norm(t.name) === n));
      if (exact) return { tag: exact, match: 'exact' };
      if (n.length >= 3) {
        const fuzzy = tags
          .filter((t) => {
            const tn = norm(t.name);
            return tn.length >= 3 && (tn.includes(n) || n.includes(tn));
          })
          .sort((a, b) => Math.abs(norm(a.name).length - n.length) - Math.abs(norm(b.name).length - n.length))[0];
        if (fuzzy) return { tag: fuzzy, match: 'fuzzy' };
        // Word overlap: every meaningful word of the label appears in the tag ("Cleaning Supplies"
        // → "Cleaning & Sanitation Supplies").
        const words = label.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
        if (words.length) {
          const byWords = tags.find((t) => {
            const tw = new Set(t.name.toLowerCase().split(/[^a-z0-9]+/));
            return words.every((w) => tw.has(w));
          });
          if (byWords) return { tag: byWords, match: 'fuzzy' };
        }
      }
      return { tag: null, match: 'none' };
    };

    const rows = dataRows
      .map((r, i) => {
        const label = r[labelColumn] ?? '';
        const amount = parseAmount(r[amountColumn]);
        if (!label && amount === null) return null;
        const m = match(label);
        return {
          row: i + (hasHeader ? 2 : 1),
          label,
          amount,
          valid: !!label && amount !== null && amount >= 0,
          suggestedCoaTagId: m.tag?.id ?? null,
          suggestedCoaTagName: m.tag?.name ?? null,
          match: m.match,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return {
      headers,
      hasHeader,
      columns,
      labelColumn,
      amountColumn,
      rows,
      tags: tags.map((t) => ({ id: t.id, name: t.name, payCategory: t.payCategory.name })),
    };
  }

  async importCommit(workspaceId: string, actor: AuditActor, dto: BudgetImportCommitDto) {
    let costCenterId: string | null = null;
    if (dto.costCenterId) {
      const bu = await this.prisma.costCenter.findFirst({ where: { id: dto.costCenterId, workspaceId } });
      if (!bu) throw new NotFoundException('Business Unit not found');
      costCenterId = bu.id;
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const createdTags: { id: string; name: string }[] = [];
        // Rows mapped to the same tag are summed (e.g. two sheet lines → one COA).
        const totals = new Map<string, number>();
        for (const [i, row] of dto.rows.entries()) {
          let tagId: string;
          if (row.coaTagId) {
            tagId = (await this.assertBudgetedTag(tx, workspaceId, row.coaTagId)).id;
          } else if (row.newTagName?.trim()) {
            const { tag, created } = await this.findOrCreateTag(tx, workspaceId, row.newTagName, row.payCategoryId);
            if (created) createdTags.push({ id: tag.id, name: tag.name });
            tagId = tag.id;
          } else {
            throw new BadRequestException(`Row ${i + 1} ("${row.label}") is not mapped to a COA tag`);
          }
          totals.set(tagId, round2((totals.get(tagId) ?? 0) + row.amount));
        }
        for (const [tagId, amount] of totals) {
          await this.writeBudget(tx, workspaceId, tagId, costCenterId, dto.period, amount);
        }
        return { imported: totals.size, rows: dto.rows.length, createdTags };
      },
      { timeout: 15_000, maxWait: 5_000 },
    );

    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.BUDGET_UPDATED, `Imported budget · ${dto.period}`, {
      period: dto.period,
      costCenterId,
      imported: result.imported,
      rows: result.rows,
      createdTags: result.createdTags.map((t) => t.name),
      total: round2(dto.rows.reduce((s, r) => s + r.amount, 0)),
    });
    return result;
  }
}
