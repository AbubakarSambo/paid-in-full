import { SheetsService } from '../sheets/sheets.service';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../platform/audit-log.service';
import { AUDIT_ACTIONS, CurrentUserData } from '../../common';
import { computeSpend, spendKey } from '../budgets/budget-spend.util';
import { DbClient, NotifyBridge, round2, toNum } from './queue-core';
import { ApproveQueueItemsDto, BudgetCheckDto } from './dto';

export interface BudgetProjection {
  coaTagId: string;
  coaTag: string;
  costCenterId: string | null;
  costCenter: string | null;
  period: string;
  cap: number;
  spent: number;
  thisAmount: number;
  projected: number;
  overBy: number;
}

export interface ApproveResult {
  ok: boolean;
  batchId?: string;
  batchRef?: string;
  total?: number;
  itemCount?: number;
  alreadyProcessed?: boolean;
  budgetWarning?: boolean;
  projections?: BudgetProjection[];
  error?: string;
}

/** Calendar parts in the workspace's timezone (batch ref month follows local time). */
function localYearMonth(date: Date, timeZone: string): { yy: string; mm: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value ?? String(date.getUTCFullYear());
    const m = parts.find((p) => p.type === 'month')?.value ?? String(date.getUTCMonth() + 1).padStart(2, '0');
    return { yy: y.slice(-2), mm: m };
  } catch {
    return { yy: String(date.getUTCFullYear()).slice(-2), mm: String(date.getUTCMonth() + 1).padStart(2, '0') };
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Spec §5.3 batch ref: `{CAT4} BATCH {YY}{MM}{SEQ}` where CAT4 = first 4 letters of the category
 * upper-cased. The spec text says SEQ3, but every example from the live app (`261068`, `261023`,
 * `261020`) uses a 2-digit sequence, so SEQ is zero-padded to 2 and grows past 99 naturally.
 * SEQ is per category per month, and `-2`, `-3`… is appended if the ref exists.
 * An editable base ref from the approver replaces the generated one (still de-duplicated).
 */
export async function nextBatchRef(
  client: DbClient,
  workspaceId: string,
  categoryName: string,
  timeZone: string,
  baseRef?: string | null,
  now = new Date(),
): Promise<string> {
  let base = baseRef?.trim().replace(/\s+/g, ' ');
  if (!base) {
    const cat4 = (categoryName || 'MISC').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'MISC';
    const { yy, mm } = localYearMonth(now, timeZone);
    const prefix = `${cat4} BATCH ${yy}${mm}`;
    const existing = await client.batch.findMany({
      where: { workspaceId, batchRef: { startsWith: prefix } },
      select: { batchRef: true },
    });
    const re = new RegExp(`^${escapeRegex(prefix)}(\\d{2,})`);
    const maxSeq = existing.reduce((max, b) => {
      const m = re.exec(b.batchRef);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    base = `${prefix}${String(maxSeq + 1).padStart(2, '0')}`;
  }
  let ref = base;
  for (let n = 2; await client.batch.findUnique({ where: { workspaceId_batchRef: { workspaceId, batchRef: ref } } }); n++) {
    ref = `${base}-${n}`;
  }
  return ref;
}

@Injectable()
export class QueueApprovalService {
  private readonly logger = new Logger(QueueApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly notifier: NotifyBridge,
    private readonly sheets: SheetsService,
  ) {}

  /**
   * Spec §5.2 approve step 1: projected spend per COA tag (for the BU and P&L month of each
   * selected line) against that month's cap. Only categories with includeInBudgets and tags that
   * have a cap produce rows. "Spent" excludes the selection itself (pending queue items count as
   * spend, so including them would double count "+This").
   */
  async projections(client: DbClient, workspaceId: string, queueItemIds: string[]): Promise<BudgetProjection[]> {
    const items = await client.queueItem.findMany({
      where: { workspaceId, id: { in: queueItemIds }, status: 'PENDING', payCategory: { includeInBudgets: true } },
      select: {
        id: true,
        total: true,
        coaTagId: true,
        coaTag: true,
        costCenterId: true,
        pnlPeriod: true,
        costCenter: { select: { name: true } },
      },
    });
    const groups = new Map<string, { coaTagId: string; coaTag: string; costCenterId: string | null; costCenter: string | null; period: string; amount: number }>();
    for (const i of items) {
      if (!i.coaTagId || !i.pnlPeriod) continue;
      const key = spendKey(i.costCenterId, i.pnlPeriod, i.coaTagId);
      const g = groups.get(key) ?? {
        coaTagId: i.coaTagId,
        coaTag: i.coaTag ?? '',
        costCenterId: i.costCenterId,
        costCenter: i.costCenter?.name ?? null,
        period: i.pnlPeriod,
        amount: 0,
      };
      g.amount = round2(g.amount + toNum(i.total));
      groups.set(key, g);
    }
    if (!groups.size) return [];

    const periods = [...new Set([...groups.values()].map((g) => g.period))];
    const coaTagIds = [...new Set([...groups.values()].map((g) => g.coaTagId))];
    const [budgets, spend] = await Promise.all([
      client.budget.findMany({ where: { workspaceId, periodMonth: { in: periods }, coaTagId: { in: coaTagIds } } }),
      computeSpend(client, workspaceId, { periods, coaTagIds, excludeQueueItemIds: queueItemIds }),
    ]);
    const capByKey = new Map(budgets.map((b) => [spendKey(b.costCenterId, b.periodMonth, b.coaTagId), toNum(b.monthlyAmount)]));

    const rows: BudgetProjection[] = [];
    for (const [key, g] of groups) {
      const cap = capByKey.get(key);
      if (cap === undefined) continue;
      const spent = round2(spend.get(key) ?? 0);
      const projected = round2(spent + g.amount);
      rows.push({
        coaTagId: g.coaTagId,
        coaTag: g.coaTag,
        costCenterId: g.costCenterId,
        costCenter: g.costCenter,
        period: g.period,
        cap,
        spent,
        thisAmount: g.amount,
        projected,
        overBy: round2(Math.max(0, projected - cap)),
      });
    }
    return rows.sort((a, b) => b.overBy - a.overBy || a.coaTag.localeCompare(b.coaTag));
  }

  async budgetCheck(workspaceId: string, dto: BudgetCheckDto) {
    const ids = await this.expandSelection(this.prisma, workspaceId, dto.queueItemIds, dto.payCategoryId);
    const projections = await this.projections(this.prisma, workspaceId, ids);
    return { anyOver: projections.some((p) => p.overBy > 0), projections };
  }

  /** The approver cancelled at the Budget Warning modal: audited per spec §5.2 step 2. */
  async recordBudgetCancel(user: CurrentUserData, dto: BudgetCheckDto) {
    const ids = await this.expandSelection(this.prisma, user.workspaceId, dto.queueItemIds, dto.payCategoryId);
    const projections = await this.projections(this.prisma, user.workspaceId, ids);
    const over = projections.filter((p) => p.overBy > 0);
    await this.audit.record(
      user.workspaceId,
      user,
      AUDIT_ACTIONS.BUDGET_WARNING_CANCELLED,
      over.map((p) => `${p.coaTag} +₦${Math.round(p.overBy).toLocaleString('en-NG')}`).join(', ') || 'Budget warning',
      { queueItemIds: ids, payCategoryId: dto.payCategoryId ?? null, projections: over },
    );
    return { recorded: true };
  }

  /** Bundles are approved as a unit: pull in every pending sibling in the same category. */
  private async expandSelection(client: DbClient, workspaceId: string, ids: string[], payCategoryId?: string): Promise<string[]> {
    const selected = await client.queueItem.findMany({
      where: { workspaceId, id: { in: ids } },
      select: { id: true, bundleId: true },
    });
    const bundleIds = [...new Set(selected.map((s) => s.bundleId).filter((x): x is string => !!x))];
    if (!bundleIds.length) return selected.map((s) => s.id);
    const siblings = await client.queueItem.findMany({
      where: { workspaceId, bundleId: { in: bundleIds }, status: 'PENDING', ...(payCategoryId && { payCategoryId }) },
      select: { id: true },
    });
    return [...new Set([...selected.map((s) => s.id), ...siblings.map((s) => s.id)])];
  }

  /**
   * Spec approve_queue_items: creates exactly ONE batch for the category from the selected
   * pending items, snapshotting vendor bank details from the register and the line's
   * classification/WHT onto BatchItems. Idempotent: if the items were already approved, the
   * existing batch is returned with alreadyProcessed = true. Row locks (SELECT … FOR UPDATE)
   * serialise concurrent approvals of the same items.
   */
  async approve(user: CurrentUserData, dto: ApproveQueueItemsDto): Promise<ApproveResult> {
    const workspaceId = user.workspaceId;
    const category = await this.prisma.payCategory.findFirst({ where: { id: dto.payCategoryId, workspaceId } });
    if (!category) throw new NotFoundException('Payment category not found');
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } });
    const approverName = user.displayName || `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email;

    let result: ApproveResult | null = null;
    for (let attempt = 1; attempt <= 3 && !result; attempt++) {
      try {
        result = await this.prisma.$transaction(
          (tx) => this.approveTx(tx, user, dto, category, workspace?.timezone ?? 'Africa/Lagos', approverName),
          { timeout: 30_000, maxWait: 10_000 },
        );
      } catch (error) {
        // Two approvals racing for the same new ref: retry with a fresh sequence.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && attempt < 3) {
          this.logger.warn(`Batch ref collision on approve (attempt ${attempt}); retrying`);
          continue;
        }
        throw error;
      }
    }
    if (!result) throw new BadRequestException('Could not approve — please retry');

    if (result.ok && !result.alreadyProcessed && result.batchRef) {
      void this.notifier.notify(workspaceId, 'batch_approved', {
        title: 'Batch approved',
        body: `${result.batchRef} — ₦${Math.round(result.total ?? 0).toLocaleString('en-NG')} approved. Open Batches to disburse.`,
        url: '/app?tab=batches',
        batchId: result.batchId,
        actorUserId: user.id,
      });
      // spec §9: append the new batch's rows to the Mastersheet (never throws)
      if (result.batchId) void this.sheets.syncBatch(workspaceId, result.batchId);
    }
    return result;
  }

  private async approveTx(
    tx: Prisma.TransactionClient,
    user: CurrentUserData,
    dto: ApproveQueueItemsDto,
    category: { id: string; name: string; color: string },
    timeZone: string,
    approverName: string,
  ): Promise<ApproveResult> {
    const workspaceId = user.workspaceId;
    const ids = await this.expandSelection(tx, workspaceId, dto.queueItemIds, dto.payCategoryId);
    if (!ids.length) throw new NotFoundException('No matching queue items');

    // Lock the rows so a double click / second approver waits, then sees them as approved.
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM queue_items WHERE workspace_id = ${workspaceId} AND id IN (${Prisma.join(ids)}) FOR UPDATE`,
    );

    const items = await tx.queueItem.findMany({
      where: { workspaceId, id: { in: ids } },
      include: { vendor: true },
      orderBy: [{ isUrgent: 'desc' }, { date: 'asc' }, { createdAt: 'asc' }],
    });
    const pending = items.filter((i) => i.status === 'PENDING');

    if (!pending.length) {
      const approved = items.filter((i) => i.status === 'APPROVED').map((i) => i.id);
      if (approved.length) {
        const line = await tx.batchItem.findFirst({
          where: { queueItemId: { in: approved }, batch: { workspaceId } },
          include: { batch: { select: { id: true, batchRef: true, total: true, _count: { select: { items: true } } } } },
          orderBy: { createdAt: 'desc' },
        });
        if (line) {
          return {
            ok: true,
            alreadyProcessed: true,
            batchId: line.batch.id,
            batchRef: line.batch.batchRef,
            total: toNum(line.batch.total),
            itemCount: line.batch._count.items,
          };
        }
      }
      return { ok: false, error: 'None of the selected items are pending' };
    }

    const wrongCategory = pending.filter((i) => i.payCategoryId !== category.id);
    if (wrongCategory.length) {
      throw new BadRequestException(
        `${wrongCategory.length} selected item(s) are not in ${category.name}. Approve creates one batch per category.`,
      );
    }
    const pendingIds = pending.map((i) => i.id);

    // Budget warning (spec §5.2 step 2).
    const projections = await this.projections(tx, workspaceId, pendingIds);
    const over = projections.filter((p) => p.overBy > 0);
    if (over.length && !dto.budgetOverride) {
      return { ok: false, budgetWarning: true, projections, error: 'Budget caps would be exceeded' };
    }

    const batchRef = await nextBatchRef(tx, workspaceId, category.name, timeZone, dto.baseRef);
    const total = round2(pending.reduce((s, i) => s + toNum(i.total), 0));
    const now = new Date();

    const batch = await tx.batch.create({
      data: {
        workspaceId,
        batchRef,
        payCategoryId: category.id,
        payCategoryName: category.name,
        payCategoryColor: category.color,
        date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
        total,
        payoutStatus: 'PENDING',
        createdById: user.id,
        approvedById: user.id,
        approvedByName: approverName,
        approvedAt: now,
        items: {
          create: pending.map((q) => ({
            queueItemId: q.id,
            date: q.date,
            vendorId: q.vendorId,
            // Bank details snapshotted from the Vendor Register at approval time.
            vendorName: q.vendor.name,
            vendorBank: q.vendor.bankName,
            vendorBankCode: q.vendor.bankCode,
            vendorAcctNo: q.vendor.bankAccountNumber,
            vendorAcctName: q.vendor.verifiedAccountName ?? q.vendor.accountName,
            description: q.description,
            bundleId: q.bundleId,
            bundleLabel: q.bundleLabel,
            units: q.units,
            unitName: q.unitName,
            unitAmount: q.unitAmount,
            total: q.total,
            whtRate: q.whtRate,
            whtAmount: q.whtAmount,
            netAmount: q.netAmount,
            payCategoryId: category.id,
            payCategoryName: category.name,
            coaTagId: q.coaTagId,
            coaTag: q.coaTag,
            costCenterId: q.costCenterId,
            locationId: q.locationId,
            pnlPeriod: q.pnlPeriod,
          })),
        },
      },
    });

    await tx.queueItem.updateMany({
      where: { workspaceId, id: { in: pendingIds }, status: 'PENDING' },
      data: { status: 'APPROVED', approvedAt: now, approvedById: user.id, budgetFlag: over.length > 0 },
    });

    if (over.length) {
      await this.audit.recordTx(
        tx,
        workspaceId,
        user,
        AUDIT_ACTIONS.BUDGET_WARNING_OVERRIDDEN,
        `${batchRef} · ${over.map((p) => `${p.coaTag} +₦${Math.round(p.overBy).toLocaleString('en-NG')}`).join(', ')}`,
        { batchId: batch.id, batchRef, projections: over },
        { type: 'batch', id: batch.id },
      );
    }
    await this.audit.recordTx(
      tx,
      workspaceId,
      user,
      AUDIT_ACTIONS.BATCH_APPROVED,
      `${batchRef} · ${pending.length} item(s)`,
      { batchId: batch.id, batchRef, total, itemCount: pending.length, payCategory: category.name, queueItemIds: pendingIds },
      { type: 'batch', id: batch.id },
    );

    return { ok: true, alreadyProcessed: false, batchId: batch.id, batchRef, total, itemCount: pending.length };
  }
}
