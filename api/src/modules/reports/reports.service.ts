import { Injectable } from '@nestjs/common';
import { BatchItemPayoutStatus, InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportPeriod } from './dto/report-query.dto';
import { dateFilter, monthEnd, resolvePeriod, ResolvedPeriod, todayIn, ym, ymd } from './report-period';

// ─── Shapes ───────────────────────────────────────────────────────────────────

export interface NamedTotal {
  key: string;
  label: string;
  items: number;
  paid: number;
  total: number;
  share: number; // 0..1 of period total spend
  color?: string | null;
}

export interface VendorTotal extends NamedTotal {
  vendorId: string;
}

export interface BusinessUnitTotal extends NamedTotal {
  costCenterId: string | null;
  code: string | null;
}

export interface CoaRow {
  coa: string;
  total: number;
  byCategory: Record<string, number>;
}

export interface MonthCategoryRow {
  month: string; // YYYY-MM
  total: number;
  byCategory: Record<string, number>;
}

export interface WhtReportLine {
  batchItemId: string;
  date: string;
  vendorId: string;
  vendor: string;
  tin: string | null;
  contractAmount: number;
  rate: number; // fraction 0..1
  wht: number;
  coa: string | null;
  description: string;
  batchRef: string;
}

export interface WhtReport {
  lines: WhtReportLine[];
  lineCount: number;
  totals: { contractAmount: number; wht: number };
  vendorsMissingTin: number;
  vendorsMissingTinNames: string[];
}

export interface BatchHistoryRow {
  batchId: string;
  batchRef: string;
  date: string;
  category: string;
  items: number;
  total: number;
  paid: number;
  status: string;
}

export interface MoneyOutReport {
  period: ResolvedPeriod;
  currency: string;
  kpis: { totalSpend: number; paid: number; outstanding: number; batches: number; items: number };
  monthlyTrend: { month: string; total: number; paid: number; items: number }[];
  categories: NamedTotal[];
  topVendors: { uniqueCount: number; rows: VendorTotal[] };
  businessUnits: BusinessUnitTotal[];
  coa: { categories: string[]; rows: CoaRow[] };
  monthlyByCategory: { categories: string[]; rows: MonthCategoryRow[]; totals: Record<string, number> };
  wht: WhtReport;
  batchHistory: BatchHistoryRow[];
}

export interface SalesReport {
  period: ResolvedPeriod;
  currency: string;
  kpis: { invoiced: number; collected: number; outstanding: number; vat: number; wht: number; count: number };
  byMonth: { month: string; invoiced: number; collected: number }[];
  byCustomer: {
    customerId: string;
    customer: string;
    invoices: number;
    invoiced: number;
    collected: number;
    outstanding: number;
  }[];
  invoices: {
    id: string;
    invoiceNumber: string | null;
    customer: string;
    issueDate: string;
    dueDate: string | null;
    status: InvoiceStatus;
    currency: string;
    total: number;
    vat: number;
    wht: number;
    amountDue: number;
    paid: number;
    outstanding: number;
  }[];
}

export interface VendorDebtRow {
  vendorId: string;
  vendor: string;
  lines: number;
  oldestItem: string | null;
  postedUnpaid: number;
  inQueue: number;
  totalOwed: number;
}

export interface VendorDebtReport {
  asOf: string; // YYYY-MM-DD month end
  currency: string;
  rows: VendorDebtRow[];
  totals: { lines: number; postedUnpaid: number; inQueue: number; totalOwed: number };
}

// Spend excludes lines whose payout failed, bounced or was cancelled (spec: "failed and cancelled payouts
// are excluded from spend"). REVERSED is a failed transfer after the fact, so it is excluded too.
const EXCLUDED_LINE_STATUSES: BatchItemPayoutStatus[] = ['FAILED', 'REVERSED', 'CANCELLED'];

const UNCATEGORIZED = 'Uncategorized';
const UNASSIGNED = 'Unassigned';
const NO_COA = 'No COA';

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
/** Paid on a line, capped at its gross. */
const linePaid = (total: number, paid: number) => Math.min(paid, total);
/** Outstanding = total − paid, 0 when paid ≥ total − 0.5 (spec §5.3). */
const lineOutstanding = (total: number, paid: number) => (paid >= total - 0.5 ? 0 : round2(total - paid));

/**
 * Spec §5.6 Reports.
 *
 * PERIOD BASIS: the spec doesn't say which date drives the reporting period. Money-out figures use the
 * batch LINE date (BatchItem.date — the bill/line date snapshotted from the queue), not the approval or
 * payout date, so a bill always lands in the same period no matter when it was paid. Batch history uses
 * the batch date. Sales uses the invoice issue date (collections by month use the payment date).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async workspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, currency: true, timezone: true, tin: true, logoUrl: true },
    });
    return {
      name: ws?.name ?? 'Paid in Full',
      currency: ws?.currency ?? 'NGN',
      timezone: ws?.timezone ?? 'Africa/Lagos',
      tin: ws?.tin ?? null,
    };
  }

  async resolve(workspaceId: string, period?: ReportPeriod, from?: string, to?: string) {
    const ws = await this.workspace(workspaceId);
    return { ws, range: resolvePeriod(period, from, to, ws.timezone) };
  }

  /** The spend base set: posted batch lines in the window (line date), excluding failed/cancelled payouts. */
  private spendWhere(workspaceId: string, range: { from: Date | null; to: Date | null }): Prisma.BatchItemWhereInput {
    return {
      batch: { workspaceId, payoutStatus: { not: 'CANCELLED' } },
      payoutStatus: { notIn: EXCLUDED_LINE_STATUSES },
      returnedAt: null,
      date: dateFilter(range),
    };
  }

  private loadSpendLines(workspaceId: string, range: { from: Date | null; to: Date | null }) {
    return this.prisma.batchItem.findMany({
      where: this.spendWhere(workspaceId, range),
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        batchId: true,
        date: true,
        vendorId: true,
        vendorName: true,
        description: true,
        total: true,
        whtRate: true,
        whtAmount: true,
        netAmount: true,
        paidAmount: true,
        payoutStatus: true,
        payCategoryName: true,
        coaTag: true,
        costCenterId: true,
        costCenter: { select: { name: true, code: true } },
        payCategory: { select: { name: true, color: true } },
        vendor: { select: { tin: true, name: true } },
        batch: { select: { batchRef: true, payCategoryName: true, payCategoryColor: true } },
      },
    });
  }

  // ─── Money out ──────────────────────────────────────────────────────────────

  async moneyOut(
    workspaceId: string,
    period?: ReportPeriod,
    from?: string,
    to?: string,
    vendorLimit = 15,
  ): Promise<MoneyOutReport> {
    const { ws, range } = await this.resolve(workspaceId, period, from, to);
    const lines = await this.loadSpendLines(workspaceId, range);

    let totalSpend = 0;
    let paidSum = 0;
    let outstandingSum = 0;
    const batchIds = new Set<string>();
    const monthly = new Map<string, { month: string; total: number; paid: number; items: number }>();
    const cats = new Map<string, NamedTotal>();
    const vendors = new Map<string, VendorTotal>();
    const bus = new Map<string, BusinessUnitTotal>();
    const coa = new Map<string, CoaRow>();
    const monthCat = new Map<string, MonthCategoryRow>();
    const catTotals: Record<string, number> = {};

    for (const l of lines) {
      const total = num(l.total);
      const paid = linePaid(total, num(l.paidAmount));
      const category = l.payCategoryName || l.payCategory?.name || l.batch.payCategoryName || UNCATEGORIZED;
      const color = l.payCategory?.color ?? l.batch.payCategoryColor ?? null;
      const month = ym(l.date);
      totalSpend += total;
      paidSum += paid;
      outstandingSum += lineOutstanding(total, num(l.paidAmount));
      batchIds.add(l.batchId);

      const mo = monthly.get(month) ?? { month, total: 0, paid: 0, items: 0 };
      mo.total += total;
      mo.paid += paid;
      mo.items += 1;
      monthly.set(month, mo);

      const c = cats.get(category) ?? { key: category, label: category, items: 0, paid: 0, total: 0, share: 0, color };
      c.items += 1;
      c.paid += paid;
      c.total += total;
      cats.set(category, c);

      // Lines imported without a vendor (deleted in the old system) group by their snapshot name.
      const vKey = l.vendorId ?? `name:${l.vendorName}`;
      const v = vendors.get(vKey) ?? {
        key: vKey,
        vendorId: l.vendorId ?? '',
        label: l.vendor?.name || l.vendorName,
        items: 0,
        paid: 0,
        total: 0,
        share: 0,
      };
      v.items += 1;
      v.paid += paid;
      v.total += total;
      vendors.set(vKey, v);

      const buKey = l.costCenterId ?? '__unassigned__';
      const b = bus.get(buKey) ?? {
        key: buKey,
        costCenterId: l.costCenterId,
        label: l.costCenter?.name ?? UNASSIGNED,
        code: l.costCenter?.code ?? null,
        items: 0,
        paid: 0,
        total: 0,
        share: 0,
      };
      b.items += 1;
      b.paid += paid;
      b.total += total;
      bus.set(buKey, b);

      const coaKey = l.coaTag || NO_COA;
      const cr = coa.get(coaKey) ?? { coa: coaKey, total: 0, byCategory: {} };
      cr.total += total;
      cr.byCategory[category] = (cr.byCategory[category] ?? 0) + total;
      coa.set(coaKey, cr);

      const mc = monthCat.get(month) ?? { month, total: 0, byCategory: {} };
      mc.total += total;
      mc.byCategory[category] = (mc.byCategory[category] ?? 0) + total;
      monthCat.set(month, mc);
      catTotals[category] = (catTotals[category] ?? 0) + total;
    }

    const withShare = <T extends NamedTotal>(rows: T[]): T[] =>
      rows
        .map((r) => ({ ...r, total: round2(r.total), paid: round2(r.paid), share: totalSpend ? r.total / totalSpend : 0 }))
        .sort((a, b) => b.total - a.total);

    const categories = withShare([...cats.values()]);
    const categoryOrder = categories.map((c) => c.key);
    const roundMap = (m: Record<string, number>) =>
      Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round2(v)]));

    const [wht, batchHistory] = await Promise.all([
      this.whtFromLines(lines),
      this.batchHistory(workspaceId, range),
    ]);

    return {
      period: range,
      currency: ws.currency,
      kpis: {
        totalSpend: round2(totalSpend),
        paid: round2(paidSum),
        outstanding: round2(outstandingSum),
        batches: batchIds.size,
        items: lines.length,
      },
      monthlyTrend: [...monthly.values()]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((m) => ({ ...m, total: round2(m.total), paid: round2(m.paid) })),
      categories,
      topVendors: { uniqueCount: vendors.size, rows: withShare([...vendors.values()]).slice(0, vendorLimit) },
      businessUnits: withShare([...bus.values()]),
      coa: {
        categories: categoryOrder,
        rows: [...coa.values()]
          .map((r) => ({ ...r, total: round2(r.total), byCategory: roundMap(r.byCategory) }))
          .sort((a, b) => b.total - a.total),
      },
      monthlyByCategory: {
        categories: categoryOrder,
        rows: [...monthCat.values()]
          .map((r) => ({ ...r, total: round2(r.total), byCategory: roundMap(r.byCategory) }))
          .sort((a, b) => a.month.localeCompare(b.month)),
        totals: roundMap(catTotals),
      },
      wht,
      batchHistory,
    };
  }

  /** WHT remittance (for FIRS): PAID lines carrying WHT, in the period (line date). */
  async whtReport(workspaceId: string, period?: ReportPeriod, from?: string, to?: string) {
    const { ws, range } = await this.resolve(workspaceId, period, from, to);
    const lines = await this.loadSpendLines(workspaceId, range);
    return { period: range, currency: ws.currency, workspaceTin: ws.tin, ...(await this.whtFromLines(lines)) };
  }

  private async whtFromLines(lines: Awaited<ReturnType<ReportsService['loadSpendLines']>>): Promise<WhtReport> {
    const out: WhtReportLine[] = [];
    let contract = 0;
    let whtSum = 0;
    const missingTin = new Map<string, string>();
    for (const l of lines) {
      const wht = num(l.whtAmount);
      if (wht <= 0) continue;
      const total = num(l.total);
      // "Paid" = the payout succeeded, or the paid amount covers the line (manual / statement-matched).
      const isPaid = l.payoutStatus === 'SUCCESS' || lineOutstanding(total, num(l.paidAmount)) === 0;
      if (!isPaid) continue;
      const tin = l.vendor?.tin?.trim() || null;
      if (!tin) missingTin.set(l.vendorId ?? `name:${l.vendorName}`, l.vendor?.name || l.vendorName);
      contract += total;
      whtSum += wht;
      out.push({
        batchItemId: l.id,
        date: ymd(l.date),
        vendorId: l.vendorId ?? '',
        vendor: l.vendor?.name || l.vendorName,
        tin,
        contractAmount: total,
        rate: num(l.whtRate) || (total ? round2(wht / total) : 0),
        wht,
        coa: l.coaTag,
        description: l.description,
        batchRef: l.batch.batchRef,
      });
    }
    return {
      lines: out,
      lineCount: out.length,
      totals: { contractAmount: round2(contract), wht: round2(whtSum) },
      vendorsMissingTin: missingTin.size,
      vendorsMissingTinNames: [...missingTin.values()].sort(),
    };
  }

  /** Batch / disbursement history, filtered on the batch date. Cancelled batches are listed (status shown). */
  async batchHistory(workspaceId: string, range: { from: Date | null; to: Date | null }): Promise<BatchHistoryRow[]> {
    const batches = await this.prisma.batch.findMany({
      where: { workspaceId, date: dateFilter(range) },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        batchRef: true,
        date: true,
        payCategoryName: true,
        total: true,
        payoutStatus: true,
        items: {
          where: { returnedAt: null, payoutStatus: { notIn: EXCLUDED_LINE_STATUSES } },
          select: { total: true, paidAmount: true },
        },
      },
    });
    return batches.map((b) => {
      const total = b.items.reduce((s, i) => s + num(i.total), 0);
      const paid = b.items.reduce((s, i) => s + linePaid(num(i.total), num(i.paidAmount)), 0);
      return {
        batchId: b.id,
        batchRef: b.batchRef,
        date: ymd(b.date),
        category: b.payCategoryName ?? UNCATEGORIZED,
        items: b.items.length,
        total: round2(b.payoutStatus === 'CANCELLED' ? num(b.total) : total),
        paid: round2(paid),
        status: b.payoutStatus,
      };
    });
  }

  // ─── Sales ──────────────────────────────────────────────────────────────────

  async sales(workspaceId: string, period?: ReportPeriod, from?: string, to?: string): Promise<SalesReport> {
    const { ws, range } = await this.resolve(workspaceId, period, from, to);
    const issued: Prisma.InvoiceWhereInput = {
      workspaceId,
      docType: 'INVOICE',
      status: { notIn: ['DRAFT', 'VOID'] },
    };
    const [invoices, payments] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { ...issued, issueDate: dateFilter(range) },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          invoiceNumber: true,
          issueDate: true,
          dueDate: true,
          status: true,
          currency: true,
          total: true,
          vatTotal: true,
          whtTotal: true,
          amountDue: true,
          paidAmount: true,
          customerId: true,
          customer: { select: { name: true } },
        },
      }),
      // Collections by month use the payment date, regardless of when the invoice was issued.
      this.prisma.invoicePayment.findMany({
        where: { invoice: issued, paidAt: this.dateTimeFilter(range) },
        select: { amount: true, paidAt: true },
      }),
    ]);

    const kpis = { invoiced: 0, collected: 0, outstanding: 0, vat: 0, wht: 0, count: invoices.length };
    const byMonth = new Map<string, { month: string; invoiced: number; collected: number }>();
    const byCustomer = new Map<string, SalesReport['byCustomer'][number]>();
    const rows: SalesReport['invoices'] = [];

    for (const inv of invoices) {
      const total = num(inv.total);
      // amountDue = total less WHT deducted at source; fall back to total for legacy rows.
      const due = num(inv.amountDue) > 0 ? num(inv.amountDue) : total;
      const paid = num(inv.paidAmount);
      const outstanding = Math.max(0, round2(due - paid));
      kpis.invoiced += total;
      kpis.collected += Math.min(paid, due);
      kpis.outstanding += outstanding;
      kpis.vat += num(inv.vatTotal);
      kpis.wht += num(inv.whtTotal);

      const month = ym(inv.issueDate);
      const m = byMonth.get(month) ?? { month, invoiced: 0, collected: 0 };
      m.invoiced += total;
      byMonth.set(month, m);

      const c = byCustomer.get(inv.customerId) ?? {
        customerId: inv.customerId,
        customer: inv.customer.name,
        invoices: 0,
        invoiced: 0,
        collected: 0,
        outstanding: 0,
      };
      c.invoices += 1;
      c.invoiced += total;
      c.collected += Math.min(paid, due);
      c.outstanding += outstanding;
      byCustomer.set(inv.customerId, c);

      rows.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customer: inv.customer.name,
        issueDate: ymd(inv.issueDate),
        dueDate: inv.dueDate ? ymd(inv.dueDate) : null,
        status: inv.status,
        currency: inv.currency,
        total,
        vat: num(inv.vatTotal),
        wht: num(inv.whtTotal),
        amountDue: due,
        paid,
        outstanding,
      });
    }
    for (const p of payments) {
      const month = ym(p.paidAt);
      const m = byMonth.get(month) ?? { month, invoiced: 0, collected: 0 };
      m.collected += num(p.amount);
      byMonth.set(month, m);
    }

    return {
      period: range,
      currency: ws.currency,
      kpis: {
        invoiced: round2(kpis.invoiced),
        collected: round2(kpis.collected),
        outstanding: round2(kpis.outstanding),
        vat: round2(kpis.vat),
        wht: round2(kpis.wht),
        count: kpis.count,
      },
      byMonth: [...byMonth.values()]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((m) => ({ ...m, invoiced: round2(m.invoiced), collected: round2(m.collected) })),
      byCustomer: [...byCustomer.values()]
        .map((c) => ({ ...c, invoiced: round2(c.invoiced), collected: round2(c.collected), outstanding: round2(c.outstanding) }))
        .sort((a, b) => b.invoiced - a.invoiced),
      invoices: rows,
    };
  }

  /** Inclusive window on a timestamp column: [from 00:00, to+1 00:00). */
  private dateTimeFilter(r: { from: Date | null; to: Date | null }): Prisma.DateTimeFilter | undefined {
    if (!r.from && !r.to) return undefined;
    const f: Prisma.DateTimeFilter = {};
    if (r.from) f.gte = r.from;
    if (r.to) f.lt = new Date(r.to.getTime() + 86_400_000);
    return f;
  }

  // ─── Vendor debt ────────────────────────────────────────────────────────────

  /**
   * What the business owed each vendor at the close of a month end.
   * - Posted unpaid: batch lines approved on/before the as-at date, minus what had been paid by then
   *   (successful payout legs completed by then; lines settled without a ledger row — manual entries,
   *   older data — count as paid if last updated by then).
   * - In queue: queue items created by then that were still waiting (pending now, or approved after).
   * Failed/cancelled/returned lines and cancelled batches are excluded (the item went back to the queue).
   */
  async vendorDebt(workspaceId: string, asOf?: string): Promise<VendorDebtReport> {
    const ws = await this.workspace(workspaceId);
    const month = asOf ?? ym(todayIn(ws.timezone));
    const end = monthEnd(month);
    const endExclusive = new Date(end.getTime() + 86_400_000);

    const [lines, queue] = await Promise.all([
      this.prisma.batchItem.findMany({
        where: {
          batch: {
            workspaceId,
            payoutStatus: { not: 'CANCELLED' },
            OR: [{ approvedAt: { lt: endExclusive } }, { approvedAt: null, createdAt: { lt: endExclusive } }],
          },
          returnedAt: null,
          payoutStatus: { notIn: ['CANCELLED', 'SKIPPED'] },
          date: { lte: end },
        },
        select: {
          id: true,
          date: true,
          vendorId: true,
          vendorName: true,
          total: true,
          paidAmount: true,
          updatedAt: true,
          payouts: { select: { amount: true, status: true, completedAt: true, createdAt: true } },
        },
      }),
      this.prisma.queueItem.findMany({
        where: {
          workspaceId,
          createdAt: { lt: endExclusive },
          OR: [{ status: 'PENDING' }, { status: 'APPROVED', approvedAt: { gte: endExclusive } }],
        },
        select: { id: true, date: true, vendorId: true, vendorName: true, total: true },
      }),
    ]);

    const vendorIds = new Set<string>([...lines.map((l) => l.vendorId).filter((v): v is string => !!v), ...queue.map((q) => q.vendorId)]);
    const vendorNames = new Map(
      (
        await this.prisma.vendor.findMany({
          where: { workspaceId, id: { in: [...vendorIds] } },
          select: { id: true, name: true },
        })
      ).map((v) => [v.id, v.name]),
    );

    const rows = new Map<string, VendorDebtRow & { oldest: Date | null }>();
    const row = (vendorId: string, fallbackName: string | null) => {
      let r = rows.get(vendorId);
      if (!r) {
        r = {
          vendorId: vendorId.startsWith('name:') ? '' : vendorId,
          vendor: vendorNames.get(vendorId) ?? fallbackName ?? 'Unknown vendor',
          lines: 0,
          oldestItem: null,
          oldest: null,
          postedUnpaid: 0,
          inQueue: 0,
          totalOwed: 0,
        };
        rows.set(vendorId, r);
      }
      return r;
    };
    const touch = (r: VendorDebtRow & { oldest: Date | null }, d: Date) => {
      if (!r.oldest || d < r.oldest) r.oldest = d;
    };

    for (const l of lines) {
      const total = num(l.total);
      let paid: number;
      if (l.payouts.length > 0) {
        paid = l.payouts
          .filter((p) => p.status === 'SUCCESS' && (p.completedAt ?? p.createdAt) < endExclusive)
          .reduce((s, p) => s + num(p.amount), 0);
      } else {
        paid = l.updatedAt < endExclusive ? num(l.paidAmount) : 0;
      }
      const owed = lineOutstanding(total, paid);
      if (owed <= 0) continue;
      const r = row(l.vendorId ?? `name:${l.vendorName}`, l.vendorName);
      r.lines += 1;
      r.postedUnpaid += owed;
      touch(r, l.date);
    }
    for (const q of queue) {
      const amount = num(q.total);
      if (amount <= 0) continue;
      const r = row(q.vendorId, q.vendorName);
      r.lines += 1;
      r.inQueue += amount;
      touch(r, q.date);
    }

    const out: VendorDebtRow[] = [...rows.values()]
      .map(({ oldest, ...r }) => ({
        ...r,
        oldestItem: oldest ? ymd(oldest) : null,
        postedUnpaid: round2(r.postedUnpaid),
        inQueue: round2(r.inQueue),
        totalOwed: round2(r.postedUnpaid + r.inQueue),
      }))
      .sort((a, b) => b.totalOwed - a.totalOwed);

    return {
      asOf: ymd(end),
      currency: ws.currency,
      rows: out,
      totals: {
        lines: out.reduce((s, r) => s + r.lines, 0),
        postedUnpaid: round2(out.reduce((s, r) => s + r.postedUnpaid, 0)),
        inQueue: round2(out.reduce((s, r) => s + r.inQueue, 0)),
        totalOwed: round2(out.reduce((s, r) => s + r.totalOwed, 0)),
      },
    };
  }

  async workspaceInfo(workspaceId: string) {
    return this.workspace(workspaceId);
  }
}
