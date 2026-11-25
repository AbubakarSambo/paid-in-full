import { SheetsService } from '../sheets/sheets.service';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BatchItem, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../platform/audit-log.service';
import { AUDIT_ACTIONS, CurrentUserData } from '../../common';
import { PayoutLedgerService } from '../wallet/payout-ledger.service';
import {
  isLegInFlight,
  isLegUnconfirmedFailure,
  legSum,
  lineSafety,
  outstandingOf,
  paidFromLegs,
  round2,
  toNum,
} from '../wallet/payout-math';
import {
  BatchQueryDto,
  CancelBatchDto,
  CancelLineDto,
  LogManualExpenseDto,
  ReclassifyLineDto,
  RenameBundleDto,
  SplitLineDto,
} from './dto';

/**
 * Spec §5.3: `{CAT4} BATCH {YY}{MM}{SEQ3}`, sequence per category per month, `-n` on clash.
 * Batch creation itself lives in the queue module (POST /queue/approve); kept exported for reuse.
 */
export async function generateBatchRef(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  categoryName: string,
  date = new Date(),
): Promise<string> {
  const cat4 = (categoryName || 'MISC').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'MISC';
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const prefix = `${cat4} BATCH ${yy}${mm}`;
  const existing = await tx.batch.count({ where: { workspaceId, batchRef: { startsWith: prefix } } });
  const base = `${prefix}${String(existing + 1).padStart(3, '0')}`;
  let ref = base;
  let n = 2;
  while (await tx.batch.findUnique({ where: { workspaceId_batchRef: { workspaceId, batchRef: ref } } })) {
    ref = `${base}-${n++}`;
  }
  return ref;
}

export const MANUAL_ENTRY_MESSAGE = 'Manual entry (paid outside the app)';

type ItemWithPayouts = Prisma.BatchItemGetPayload<{ include: { payouts: true } }>;

async function lockBatch(tx: Prisma.TransactionClient, workspaceId: string, batchId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM batches WHERE id = ${batchId} AND workspace_id = ${workspaceId} FOR UPDATE`;
  if (!rows.length) throw new NotFoundException('Batch not found');
}

/** Monday 00:00 in Africa/Lagos (UTC+1, no DST). */
function startOfWeekLagos(now = new Date()): Date {
  const lagos = new Date(now.getTime() + 3_600_000);
  const dow = (lagos.getUTCDay() + 6) % 7;
  const monday = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() - dow);
  return new Date(monday - 3_600_000);
}

export function bundleKeyOf(item: { bundleId: string | null; bundleLabel: string | null }): string | null {
  if (item.bundleId) return item.bundleId;
  if (item.bundleLabel) return `label:${item.bundleLabel}`;
  return null;
}

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly ledger: PayoutLedgerService,
    private readonly sheets: SheetsService,
  ) {}

  // ─── List + KPIs ──────────────────────────────────────────────────────────

  async list(workspaceId: string, query: BatchQueryDto) {
    const batches = await this.prisma.batch.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        items: { select: { id: true, vendorName: true, total: true, paidAmount: true, payoutStatus: true } },
      },
    });

    const summaries = batches.map(({ items, ...b }) => {
      const active = items.filter((i) => i.payoutStatus !== 'CANCELLED');
      const paid = round2(items.reduce((s, i) => s + toNum(i.paidAmount), 0));
      const outstanding = round2(active.reduce((s, i) => s + outstandingOf(i.total, i.paidAmount), 0));
      const readyCount = active.filter(
        (i) => i.payoutStatus !== 'SENDING' && i.payoutStatus !== 'SUCCESS' && outstandingOf(i.total, i.paidAmount) > 0,
      ).length;
      return {
        ...b,
        itemCount: items.length,
        activeItemCount: active.length,
        paid,
        outstanding,
        readyCount,
        inFlightCount: active.filter((i) => i.payoutStatus === 'SENDING').length,
        failedCount: active.filter((i) => i.payoutStatus === 'FAILED' || i.payoutStatus === 'REVERSED').length,
        vendors: [...new Set(items.map((i) => i.vendorName))],
        isReady: b.payoutStatus !== 'CANCELLED' && readyCount > 0,
      };
    });

    const q = query.search?.trim().toLowerCase();
    const filtered = summaries.filter((b) => {
      if (q) {
        const hay = [b.batchRef, b.payCategoryName ?? '', b.payoutStatus, ...b.vendors].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      switch (query.status ?? 'all') {
        case 'all':
          return true;
        case 'ready':
          return b.isReady;
        case 'paid':
          return b.payoutStatus === 'SUCCESS';
        default:
          return b.payoutStatus === query.status;
      }
    });

    return {
      kpis: await this.kpis(workspaceId),
      counts: {
        all: summaries.length,
        ready: summaries.filter((b) => b.isReady).length,
        paid: summaries.filter((b) => b.payoutStatus === 'SUCCESS').length,
      },
      batches: filtered.filter((b) => b.payoutStatus !== 'SUCCESS'),
      paidBatches: filtered.filter((b) => b.payoutStatus === 'SUCCESS'),
    };
  }

  async kpis(workspaceId: string) {
    const [openItems, inFlight, paidWeek, failed] = await Promise.all([
      this.prisma.batchItem.findMany({
        where: {
          batch: { workspaceId, payoutStatus: { not: 'CANCELLED' } },
          payoutStatus: { in: ['PENDING', 'FAILED', 'REVERSED', 'SKIPPED'] },
        },
        include: { payouts: true },
      }),
      this.prisma.batchItemPayout.findMany({
        where: { workspaceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { amount: true, transferReference: true, reference: true },
      }),
      this.prisma.batchItemPayout.findMany({
        where: { workspaceId, status: 'SUCCESS', completedAt: { gte: startOfWeekLagos() } },
        select: { amount: true, batchItemId: true },
      }),
      this.prisma.batchItem.findMany({
        where: { batch: { workspaceId, payoutStatus: { not: 'CANCELLED' } }, payoutStatus: { in: ['FAILED', 'REVERSED'] } },
        select: { total: true, paidAmount: true },
      }),
    ]);
    const ready = openItems.filter((i) => lineSafety(i).selectable);
    return {
      readyToPay: {
        batches: new Set(ready.map((i) => i.batchId)).size,
        lines: ready.length,
        amount: round2(ready.reduce((s, i) => s + outstandingOf(i.total, i.paidAmount), 0)),
      },
      inFlight: {
        transfers: new Set(inFlight.map((p) => p.transferReference ?? p.reference)).size,
        amount: round2(inFlight.reduce((s, p) => s + toNum(p.amount), 0)),
      },
      paidThisWeek: {
        lines: new Set(paidWeek.map((p) => p.batchItemId)).size,
        amount: round2(paidWeek.reduce((s, p) => s + toNum(p.amount), 0)),
      },
      failedLines: {
        lines: failed.length,
        amount: round2(failed.reduce((s, i) => s + outstandingOf(i.total, i.paidAmount), 0)),
      },
    };
  }

  // ─── Detail ───────────────────────────────────────────────────────────────

  async findOne(workspaceId: string, id: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id, workspaceId },
      include: {
        items: {
          orderBy: [{ bundleLabel: 'asc' }, { createdAt: 'asc' }],
          include: {
            payouts: { orderBy: { createdAt: 'asc' } },
            costCenter: { select: { id: true, name: true, code: true } },
            location: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    const lines = batch.items.map((item) => this.lineView(item));
    const bundles = new Map<string, { bundleKey: string; label: string; itemCount: number; total: number; paid: number }>();
    for (const l of lines) {
      const key = bundleKeyOf(l);
      if (!key) continue;
      const b = bundles.get(key) ?? { bundleKey: key, label: l.bundleLabel ?? 'Bundle', itemCount: 0, total: 0, paid: 0 };
      b.itemCount++;
      b.total = round2(b.total + toNum(l.total));
      b.paid = round2(b.paid + l.paid);
      bundles.set(key, b);
    }
    const active = lines.filter((l) => l.payoutStatus !== 'CANCELLED');
    return {
      ...batch,
      items: lines,
      bundleTotals: [...bundles.values()],
      totals: {
        total: round2(active.reduce((s, l) => s + toNum(l.total), 0)),
        paid: round2(lines.reduce((s, l) => s + l.paid, 0)),
        outstanding: round2(active.reduce((s, l) => s + l.outstanding, 0)),
        failedLines: active.filter((l) => l.payoutStatus === 'FAILED' || l.payoutStatus === 'REVERSED').length,
        inFlightLines: active.filter((l) => l.payoutStatus === 'SENDING').length,
      },
      untouched: lines.every((l) => !l.hasPayoutAttempt),
    };
  }

  private lineView<T extends ItemWithPayouts>(item: T) {
    const paid = paidFromLegs(item.payouts);
    const outstanding = item.payoutStatus === 'CANCELLED' ? 0 : outstandingOf(item.total, paid);
    const safety = lineSafety(item);
    return {
      ...item,
      paid,
      outstanding,
      isPaid: item.payoutStatus !== 'CANCELLED' && outstandingOf(item.total, paid) === 0,
      selectable: safety.selectable,
      unsafeReason: safety.reason ?? null,
      hasPayoutAttempt: item.payouts.length > 0,
      whtPaid: legSum(item.payouts, 'WHT', ['SUCCESS']),
      bundleKey: bundleKeyOf(item),
    };
  }

  private async loadLine(tx: Prisma.TransactionClient, batchId: string, itemId: string) {
    const item = await tx.batchItem.findFirst({ where: { id: itemId, batchId }, include: { payouts: true, batch: true } });
    if (!item) throw new NotFoundException('Batch line not found');
    return item;
  }

  private assertNotInFlight(item: ItemWithPayouts) {
    if (item.payouts.some(isLegInFlight)) throw new BadRequestException('A transfer for this line is still in flight — check status first');
    if (item.payouts.some(isLegUnconfirmedFailure)) {
      throw new BadRequestException('This line failed without a status check — run Check status first');
    }
  }

  // ─── Line actions ─────────────────────────────────────────────────────────

  async cancelLine(user: CurrentUserData, batchId: string, itemId: string, dto: CancelLineDto) {
    const ws = user.workspaceId;
    const res = await this.prisma.$transaction(async (tx) => {
      await lockBatch(tx, ws, batchId);
      const item = await this.loadLine(tx, batchId, itemId);
      if (item.batch.payoutStatus === 'CANCELLED') throw new BadRequestException('This batch is cancelled');
      if (item.payoutStatus === 'CANCELLED') return item;
      this.assertNotInFlight(item);
      const paid = paidFromLegs(item.payouts);
      if (outstandingOf(item.total, paid) === 0) throw new BadRequestException('This line is already paid');

      const updated = await tx.batchItem.update({
        where: { id: itemId },
        data: { payoutStatus: 'CANCELLED', payoutMessage: `Cancelled${dto.reason ? `: ${dto.reason}` : ''}` },
      });
      if (item.queueItemId && paid === 0) {
        const others = await tx.batchItem.count({ where: { queueItemId: item.queueItemId, id: { not: itemId }, payoutStatus: { not: 'CANCELLED' } } });
        if (!others) await tx.queueItem.update({ where: { id: item.queueItemId }, data: { status: 'CANCELLED' } });
      }
      await this.ledger.recomputeBatch(tx, batchId);
      await this.audit.recordTx(tx, ws, user, AUDIT_ACTIONS.BATCH_LINE_CANCELLED, `${item.batch.batchRef} · ${item.vendorName}`, {
        itemId,
        total: toNum(item.total),
        paid,
        reason: dto.reason ?? null,
      }, { type: 'batch_item', id: itemId });
      return updated;
    });
    return res;
  }

  /** Return to queue: only for lines that never had a payout attempt. */
  async returnLine(user: CurrentUserData, batchId: string, itemId: string) {
    const ws = user.workspaceId;
    return this.prisma.$transaction(async (tx) => {
      await lockBatch(tx, ws, batchId);
      const item = await this.loadLine(tx, batchId, itemId);
      if (item.payoutStatus === 'CANCELLED') throw new BadRequestException('This line is already cancelled or returned');
      if (item.payouts.length) throw new BadRequestException('This line has payout attempts — it cannot go back to the queue (cancel it instead)');
      if (!item.queueItemId) throw new BadRequestException('Manual entries cannot be returned to the queue');

      const queueItemIds = await this.requeue(tx, [item]);
      await tx.batchItem.update({
        where: { id: itemId },
        data: { payoutStatus: 'CANCELLED', payoutMessage: 'Returned to queue', returnedAt: new Date(), returnedById: user.id },
      });
      await this.ledger.recomputeBatch(tx, batchId);
      await this.audit.recordTx(tx, ws, user, AUDIT_ACTIONS.BATCH_LINE_RETURNED, `${item.batch.batchRef} · ${item.vendorName}`, {
        itemId,
        queueItemIds,
        total: toNum(item.total),
      }, { type: 'batch_item', id: itemId });
      return { returned: true, queueItemIds };
    });
  }

  /**
   * Puts unpaid batch lines back into the queue as PENDING. If the original queue item has no
   * other live lines it is reopened (with the line's current amounts and tagging); otherwise a
   * copy is created per line so split parts that were already paid stay accounted for.
   */
  private async requeue(tx: Prisma.TransactionClient, lines: BatchItem[]): Promise<string[]> {
    // Lines imported from the old system can have no vendor (the vendor was deleted there). The queue
    // needs a vendor to pay, so the user must pick one first; refuse rather than invent one.
    const noVendor = lines.find((l) => !l.vendorId);
    if (noVendor) {
      throw new BadRequestException(`"${noVendor.vendorName}" is no longer in your vendor list — add the vendor again before returning this line to the queue`);
    }
    const byQ = new Map<string, BatchItem[]>();
    for (const l of lines) if (l.queueItemId) byQ.set(l.queueItemId, [...(byQ.get(l.queueItemId) ?? []), l]);
    const ids: string[] = [];
    for (const [qid, ls] of byQ) {
      const q = await tx.queueItem.findUnique({ where: { id: qid } });
      if (!q) continue;
      const others = await tx.batchItem.count({
        where: { queueItemId: qid, id: { notIn: ls.map((l) => l.id) }, payoutStatus: { not: 'CANCELLED' } },
      });
      if (!others) {
        const sum = (f: (l: BatchItem) => number) => round2(ls.reduce((s, l) => s + f(l), 0));
        const first = ls[0];
        await tx.queueItem.update({
          where: { id: qid },
          data: {
            status: 'PENDING',
            approvedAt: null,
            approvedById: null,
            total: sum((l) => toNum(l.total)),
            whtAmount: sum((l) => toNum(l.whtAmount)),
            netAmount: sum((l) => toNum(l.netAmount)),
            ...(ls.length === 1 && {
              description: first.description,
              units: first.units,
              unitAmount: first.unitAmount,
            }),
            vendorId: first.vendorId!, // guarded above
            vendorName: first.vendorName,
            coaTagId: first.coaTagId,
            coaTag: first.coaTag,
            payCategoryId: first.payCategoryId,
            payCategoryName: first.payCategoryName,
            costCenterId: first.costCenterId,
            locationId: first.locationId,
            pnlPeriod: first.pnlPeriod,
            bundleLabel: first.bundleLabel,
          },
        });
        ids.push(qid);
      } else {
        for (const l of ls) {
          const created = await tx.queueItem.create({
            data: {
              workspaceId: q.workspaceId,
              date: l.date,
              vendorId: l.vendorId!, // guarded above
              vendorName: l.vendorName,
              description: l.description,
              units: l.units,
              unitName: l.unitName,
              unitAmount: l.unitAmount,
              total: l.total,
              whtRate: l.whtRate,
              whtAmount: l.whtAmount,
              netAmount: l.netAmount,
              whtOverride: q.whtOverride,
              whtSource: q.whtSource,
              payCategoryId: l.payCategoryId,
              payCategoryName: l.payCategoryName,
              coaTagId: l.coaTagId,
              coaTag: l.coaTag,
              costCenterId: l.costCenterId,
              locationId: l.locationId,
              pnlPeriod: l.pnlPeriod,
              isUrgent: q.isUrgent,
              bundleId: l.bundleId,
              bundleLabel: l.bundleLabel,
              attachmentGroupId: q.attachmentGroupId,
              invoiceNumber: q.invoiceNumber,
              invoiceDate: q.invoiceDate,
              status: 'PENDING',
              createdById: q.createdById,
              createdByName: q.createdByName,
              requestedByName: q.requestedByName,
            },
          });
          ids.push(created.id);
        }
      }
    }
    return ids;
  }

  /** Split line: keep `payNowAmount` outstanding on this line, move the remainder to a new line. */
  async splitLine(user: CurrentUserData, batchId: string, itemId: string, dto: SplitLineDto) {
    const ws = user.workspaceId;
    return this.prisma.$transaction(async (tx) => {
      await lockBatch(tx, ws, batchId);
      const item = await this.loadLine(tx, batchId, itemId);
      if (item.batch.payoutStatus === 'CANCELLED' || item.payoutStatus === 'CANCELLED') {
        throw new BadRequestException('Cancelled lines cannot be split');
      }
      this.assertNotInFlight(item);
      const total = toNum(item.total);
      const paid = paidFromLegs(item.payouts);
      const outstanding = outstandingOf(total, paid);
      const payNow = round2(dto.payNowAmount);
      const remainder = round2(outstanding - payNow);
      if (payNow <= 0 || remainder < 1) {
        throw new BadRequestException(`Pay-now amount must leave a remainder of at least ₦1 out of the outstanding ₦${outstanding.toLocaleString()}`);
      }

      const whtTotal = toNum(item.whtAmount);
      const whtPaid = legSum(item.payouts, 'WHT', ['SUCCESS']);
      const whtRemainder = whtTotal > 0 ? Math.min(Math.max(0, round2(whtTotal - whtPaid)), Math.round((whtTotal * remainder) / total)) : 0;
      const newTotal = round2(total - remainder);
      const newWht = round2(whtTotal - whtRemainder);

      await tx.batchItem.update({
        where: { id: itemId },
        data: { total: newTotal, whtAmount: newWht, netAmount: round2(newTotal - newWht) },
      });
      const { id: _id, createdAt: _c, updatedAt: _u, payouts: _p, batch: _b, ...rest } = item;
      const created = await tx.batchItem.create({
        data: {
          ...rest,
          description: dto.remainderDescription?.trim() || `${item.description} (balance)`,
          units: 1,
          unitAmount: remainder,
          total: remainder,
          whtAmount: whtRemainder,
          netAmount: round2(remainder - whtRemainder),
          paidAmount: 0,
          payoutStatus: 'PENDING',
          payoutReference: null,
          payoutMessage: `Split from line (${item.vendorName})`,
          retriedAt: null,
          syncedToSheets: false,
        },
      });
      await this.ledger.recomputeLine(tx, itemId);
      await this.ledger.recomputeBatch(tx, batchId);
      await this.audit.recordTx(tx, ws, user, AUDIT_ACTIONS.BATCH_LINE_SPLIT, `${item.batch.batchRef} · ${item.vendorName}`, {
        itemId,
        newItemId: created.id,
        payNow,
        remainder,
      }, { type: 'batch_item', id: itemId });
      return { itemId, newItemId: created.id, payNow, remainder };
    });
  }

  /** Details → reclassify BU, BU head, COA, period, vendor, description. */
  async reclassifyLine(user: CurrentUserData, batchId: string, itemId: string, dto: ReclassifyLineDto) {
    const ws = user.workspaceId;
    const result = await this.prisma.$transaction(async (tx) => {
      await lockBatch(tx, ws, batchId);
      const item = await this.loadLine(tx, batchId, itemId);
      const data: Prisma.BatchItemUncheckedUpdateInput = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const set = <K extends keyof BatchItem>(key: K, value: BatchItem[K]) => {
        if (item[key] !== value) {
          (data as Record<string, unknown>)[key as string] = value;
          changes[key as string] = { from: item[key], to: value };
        }
      };

      const costCenterId = dto.costCenterId ?? item.costCenterId;
      if (dto.costCenterId) {
        const cc = await tx.costCenter.findFirst({ where: { id: dto.costCenterId, workspaceId: ws } });
        if (!cc) throw new BadRequestException('Business unit not found');
        set('costCenterId', cc.id);
        if (dto.locationId === undefined && item.locationId && item.costCenterId !== cc.id) set('locationId', null);
      }
      if (dto.locationId !== undefined) {
        if (dto.locationId === null) set('locationId', null);
        else {
          const loc = await tx.location.findFirst({ where: { id: dto.locationId, workspaceId: ws } });
          if (!loc) throw new BadRequestException('BU head not found');
          if (costCenterId && loc.costCenterId && loc.costCenterId !== costCenterId) {
            throw new BadRequestException('That BU head belongs to a different business unit');
          }
          set('locationId', loc.id);
        }
      }
      if (dto.coaTagId) {
        const tag = await tx.coaTag.findFirst({ where: { id: dto.coaTagId, workspaceId: ws }, include: { payCategory: true } });
        if (!tag) throw new BadRequestException('COA tag not found');
        set('coaTagId', tag.id);
        set('coaTag', tag.name);
        set('payCategoryId', tag.payCategoryId);
        set('payCategoryName', tag.payCategory.name);
      }
      if (dto.pnlPeriod) set('pnlPeriod', dto.pnlPeriod);
      if (dto.description) set('description', dto.description.trim());
      if (dto.vendorId && dto.vendorId !== item.vendorId) {
        this.assertNotInFlight(item);
        if (paidFromLegs(item.payouts) > 0) throw new BadRequestException('The vendor cannot be changed after part of the line was paid');
        const v = await tx.vendor.findFirst({ where: { id: dto.vendorId, workspaceId: ws } });
        if (!v) throw new BadRequestException('Vendor not found in the register');
        set('vendorId', v.id);
        set('vendorName', v.name);
        set('vendorBank', v.bankName);
        set('vendorBankCode', v.bankCode);
        set('vendorAcctNo', v.bankAccountNumber);
        set('vendorAcctName', v.verifiedAccountName ?? v.accountName);
        if (item.payoutStatus === 'SKIPPED') data.payoutStatus = 'PENDING';
      }
      if (!Object.keys(changes).length) return { item, changes };
      data.syncedToSheets = false;
      const updated = await tx.batchItem.update({ where: { id: itemId }, data });
      await this.audit.recordTx(tx, ws, user, AUDIT_ACTIONS.BATCH_LINE_RECLASSIFIED, `${item.batch.batchRef} · ${item.vendorName}`, {
        itemId,
        changes,
        note: 'Resync the sheet afterwards',
      }, { type: 'batch_item', id: itemId });
      return { item: updated, changes };
    });
    // spec §9: re-sync the sheet after a reclassify (never throws)
    if (Object.keys(result.changes).length) void this.sheets.syncBatch(ws, batchId);
    return result;
  }

  // ─── Batch actions ────────────────────────────────────────────────────────

  /** Cancel batch: unpaid lines go back to the queue as PENDING; the batch stays on record. */
  async cancelBatch(user: CurrentUserData, batchId: string, dto: CancelBatchDto) {
    const ws = user.workspaceId;
    return this.prisma.$transaction(async (tx) => {
      await lockBatch(tx, ws, batchId);
      const batch = await tx.batch.findUniqueOrThrow({ where: { id: batchId }, include: { items: { include: { payouts: true } } } });
      if (batch.payoutStatus === 'CANCELLED') return { cancelled: true, alreadyCancelled: true, returned: 0 };
      for (const item of batch.items) this.assertNotInFlight(item);

      const live = batch.items.filter((i) => i.payoutStatus !== 'CANCELLED');
      const unpaid = live.filter((i) => paidFromLegs(i.payouts) === 0 && i.queueItemId);
      const queueItemIds = await this.requeue(tx, unpaid);
      const unpaidIds = new Set(unpaid.map((i) => i.id));
      for (const item of live) {
        await tx.batchItem.update({
          where: { id: item.id },
          data: {
            payoutStatus: 'CANCELLED',
            payoutMessage: unpaidIds.has(item.id) ? 'Batch cancelled — returned to queue' : 'Batch cancelled',
            ...(unpaidIds.has(item.id) && { returnedAt: new Date(), returnedById: user.id }),
          },
        });
      }
      await tx.batch.update({
        where: { id: batchId },
        data: { payoutStatus: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelledReason: dto.reason ?? null },
      });
      await tx.payoutFundingWait.updateMany({ where: { batchId, status: 'WAITING' }, data: { status: 'CANCELLED', resolvedAt: new Date() } });
      await this.audit.recordTx(tx, ws, user, AUDIT_ACTIONS.BATCH_CANCELLED, batch.batchRef, {
        reason: dto.reason ?? null,
        returnedLines: unpaid.length,
        queueItemIds,
      }, { type: 'batch', id: batchId });
      return { cancelled: true, returned: unpaid.length, queueItemIds };
    });
  }

  /**
   * delete_untouched_batch: only when no line ever had a payout attempt. Deletes the batch and
   * its lines and returns nothing to the queue (spec §5.3); the source queue items are marked
   * CANCELLED so they don't linger as "approved" with no batch.
   */
  async deleteUntouched(user: CurrentUserData, batchId: string) {
    const ws = user.workspaceId;
    return this.prisma.$transaction(async (tx) => {
      await lockBatch(tx, ws, batchId);
      const batch = await tx.batch.findUniqueOrThrow({ where: { id: batchId }, include: { items: { include: { _count: { select: { payouts: true } } } } } });
      if (batch.items.some((i) => i._count.payouts > 0)) {
        throw new BadRequestException('Only untouched batches can be deleted — this one has payout attempts. Cancel it instead.');
      }
      const queueItemIds = [...new Set(batch.items.map((i) => i.queueItemId).filter((x): x is string => !!x))];
      if (queueItemIds.length) {
        await tx.queueItem.updateMany({ where: { id: { in: queueItemIds }, workspaceId: ws }, data: { status: 'CANCELLED' } });
      }
      await tx.batch.delete({ where: { id: batchId } });
      await this.audit.recordTx(tx, ws, user, AUDIT_ACTIONS.BATCH_DELETED, batch.batchRef, {
        total: toNum(batch.total),
        items: batch.items.length,
        queueItemIds,
      }, { type: 'batch', id: batchId });
      return { deleted: true };
    });
  }

  async renameBundle(user: CurrentUserData, batchId: string, bundleKey: string, dto: RenameBundleDto) {
    const ws = user.workspaceId;
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, workspaceId: ws } });
    if (!batch) throw new NotFoundException('Batch not found');
    const where: Prisma.BatchItemWhereInput = bundleKey.startsWith('label:')
      ? { batchId, bundleId: null, bundleLabel: bundleKey.slice(6) }
      : { batchId, bundleId: bundleKey };
    const res = await this.prisma.batchItem.updateMany({ where, data: { bundleLabel: dto.label.trim(), syncedToSheets: false } });
    if (!res.count) throw new NotFoundException('Bundle not found in this batch');
    await this.audit.record(ws, user, 'batch.bundle_renamed', batch.batchRef, { bundleKey, label: dto.label, lines: res.count }, { type: 'batch', id: batchId });
    return { renamed: res.count, bundleKey: bundleKey.startsWith('label:') ? `label:${dto.label.trim()}` : bundleKey, label: dto.label.trim() };
  }

  // ─── Manual expense ───────────────────────────────────────────────────────

  /**
   * "Log manual expense": spend paid outside the app (cash, direct transfer). Adds a line marked
   * paid to the category's monthly manual batch (`{CAT4} MANUAL {YY}{MM}`). The wallet is not
   * touched; a MANUAL- ledger leg records the payment so paid/outstanding stay ledger-derived.
   */
  async logManualExpense(user: CurrentUserData, dto: LogManualExpenseDto) {
    const ws = user.workspaceId;
    const [category, tag, vendor, cc, loc] = await Promise.all([
      this.prisma.payCategory.findFirst({ where: { id: dto.payCategoryId, workspaceId: ws } }),
      this.prisma.coaTag.findFirst({ where: { id: dto.coaTagId, workspaceId: ws } }),
      this.prisma.vendor.findFirst({ where: { id: dto.vendorId, workspaceId: ws } }),
      this.prisma.costCenter.findFirst({ where: { id: dto.costCenterId, workspaceId: ws } }),
      this.prisma.location.findFirst({ where: { id: dto.locationId, workspaceId: ws } }),
    ]);
    if (!category) throw new BadRequestException('Payment category not found');
    if (!tag || tag.payCategoryId !== category.id) throw new BadRequestException('The COA tag must belong to the chosen category');
    if (!vendor) throw new BadRequestException('Vendor not found in the register');
    if (!cc) throw new BadRequestException('Business unit not found');
    if (!loc || (loc.costCenterId && loc.costCenterId !== cc.id)) throw new BadRequestException('BU head must belong to the business unit');

    const units = dto.units ?? 1;
    const total = round2(units * dto.unitAmount);
    if (total <= 0) throw new BadRequestException('Total must be positive');
    const date = new Date(dto.date);
    const pnlPeriod = dto.pnlPeriod ?? dto.date.slice(0, 7);
    const cat4 = category.name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'MISC';
    const batchRef = `${cat4} MANUAL ${String(date.getUTCFullYear()).slice(-2)}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      let batch = await tx.batch.findUnique({ where: { workspaceId_batchRef: { workspaceId: ws, batchRef } } });
      if (!batch) {
        batch = await tx.batch.create({
          data: {
            workspaceId: ws,
            batchRef,
            payCategoryId: category.id,
            payCategoryName: category.name,
            payCategoryColor: category.color,
            date,
            total: 0,
            payoutStatus: 'SUCCESS',
            isManual: true,
            createdById: user.id,
            approvedById: user.id,
            approvedByName: user.displayName,
            approvedAt: new Date(),
          },
        });
      } else if (batch.payoutStatus === 'CANCELLED') {
        throw new BadRequestException(`${batchRef} is cancelled`);
      }
      await lockBatch(tx, ws, batch.id);

      const item = await tx.batchItem.create({
        data: {
          batchId: batch.id,
          date,
          vendorId: vendor.id,
          vendorName: vendor.name,
          vendorBank: vendor.bankName,
          vendorBankCode: vendor.bankCode,
          vendorAcctNo: vendor.bankAccountNumber,
          vendorAcctName: vendor.verifiedAccountName ?? vendor.accountName,
          description: dto.description.trim(),
          units,
          unitName: dto.unitName,
          unitAmount: dto.unitAmount,
          total,
          whtRate: 0,
          whtAmount: 0,
          netAmount: total,
          paidAmount: total,
          payoutStatus: 'SUCCESS',
          payoutMessage: MANUAL_ENTRY_MESSAGE,
          payCategoryId: category.id,
          payCategoryName: category.name,
          coaTagId: tag.id,
          coaTag: tag.name,
          costCenterId: cc.id,
          locationId: loc.id,
          pnlPeriod,
          isManual: true,
        },
      });
      const reference = `MANUAL-${item.id}`;
      await tx.batchItemPayout.create({
        data: {
          workspaceId: ws,
          batchItemId: item.id,
          leg: 'VENDOR',
          amount: total,
          status: 'SUCCESS',
          reference,
          transferReference: reference,
          destinationAccountNumber: vendor.bankAccountNumber,
          destinationBankCode: vendor.bankCode,
          destinationAccountName: vendor.verifiedAccountName ?? vendor.accountName,
          initiatedById: user.id,
          completedAt: date,
          statusCheckedAt: new Date(),
          failureReason: null,
        },
      });
      await tx.batchItem.update({ where: { id: item.id }, data: { payoutReference: reference } });
      await tx.batch.update({ where: { id: batch.id }, data: { total: { increment: total } } });
      await this.ledger.recomputeBatch(tx, batch.id);
      await this.audit.recordTx(tx, ws, user, AUDIT_ACTIONS.BATCH_MANUAL_EXPENSE_LOGGED, `${batchRef} · ${vendor.name}`, {
        itemId: item.id,
        total,
        coaTag: tag.name,
        pnlPeriod,
      }, { type: 'batch_item', id: item.id });
      return { batchId: batch.id, batchRef, itemId: item.id, total, message: MANUAL_ENTRY_MESSAGE };
    });
  }
}
