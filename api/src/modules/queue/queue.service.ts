import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QueueItem } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../platform/audit-log.service';
import { AUDIT_ACTIONS, CurrentUserData, canApprove } from '../../common';
import { computeWht } from '../wht/wht.service';
import { computeSpend, spendKey } from '../budgets/budget-spend.util';
import {
  DbClient,
  NotifyBridge,
  PERIOD_PATTERN,
  QueueActor,
  QueueLineBuilder,
  QueueLineContext,
  QueueLineInput,
  round2,
  toDateOnly,
  toNum,
} from './queue-core';
import {
  AddBundleItemsDto,
  AddCommentDto,
  BulkCreateQueueDto,
  CreateBundleDto,
  CreateQueueItemDto,
  CsvTextDto,
  QueueQueryDto,
  RejectQueueItemDto,
  SplitQueueItemDto,
  UpdateQueueItemDto,
} from './dto';
import {
  QUEUE_CSV_ALIASES,
  QUEUE_CSV_COLUMNS,
  csvEscape,
  headerKey,
  parseCsvAmount,
  parseCsvText,
} from './queue-csv.util';

const ITEM_LIST_INCLUDE = {
  vendor: {
    select: { id: true, name: true, tin: true, phone: true, bankName: true, bankAccountNumber: true, bankCode: true },
  },
  costCenter: { select: { id: true, name: true, code: true } },
  location: { select: { id: true, name: true, isGeneral: true } },
  requisition: { select: { id: true, reqRef: true, requesterName: true } },
  _count: { select: { comments: true, attachments: true } },
} satisfies Prisma.QueueItemInclude;

type ListItem = Prisma.QueueItemGetPayload<{ include: typeof ITEM_LIST_INCLUDE }>;

export interface CsvPreviewRow {
  row: number;
  status: 'ok' | 'duplicate' | 'error';
  date: string | null;
  vendor: string;
  description: string;
  category: string;
  coa: string;
  units: number | null;
  unitAmount: number | null;
  amount: number | null;
  notes: string[];
}

function actorOf(user: CurrentUserData): QueueActor {
  return { id: user.id, displayName: user.displayName || `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email };
}

function duplicateConflict(duplicates: unknown, rows?: unknown): ConflictException {
  return new ConflictException({
    message: 'Possible duplicate: the same vendor and amount appear in the queue or batches within 7 days. Confirm to add anyway.',
    errors: { code: 'DUPLICATE_WARNING', duplicates, rows },
  });
}

function hasVendorTinAndPhone(v: { tin: string | null; phone: string | null }): boolean {
  return !!v.tin?.trim() && !!v.phone?.trim();
}

@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: QueueLineBuilder,
    private readonly audit: AuditLogService,
    private readonly notifier: NotifyBridge,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private assertWhtPermission(user: CurrentUserData, override: unknown) {
    if (override !== undefined && !canApprove(user)) {
      throw new ForbiddenException('Approver role required to set or override WHT');
    }
  }

  private async getItem(workspaceId: string, id: string, client: DbClient = this.prisma): Promise<QueueItem> {
    const item = await client.queueItem.findFirst({ where: { id, workspaceId } });
    if (!item) throw new NotFoundException('Queue item not found');
    return item;
  }

  private assertEditable(item: QueueItem) {
    if (item.status === 'APPROVED') throw new ConflictException('This item has already been approved into a batch');
  }

  /** A queue item created from a requisition goes back to "cleared" when the item is deleted. */
  private async releaseRequisitions(tx: Prisma.TransactionClient, workspaceId: string, requisitionIds: (string | null)[]) {
    const ids = requisitionIds.filter((x): x is string => !!x);
    if (!ids.length) return;
    await tx.requisition.updateMany({
      where: { workspaceId, id: { in: ids }, status: 'QUEUED' },
      data: { status: 'PROCUREMENT_CLEARED', queuedAt: null, queuedById: null },
    });
  }

  private notifyAdded(workspaceId: string, user: CurrentUserData, count: number, total: number, label: string) {
    void this.notifier.notify(workspaceId, 'queue_added', {
      title: count === 1 ? 'New queue item' : `${count} new queue items`,
      body: `${label} · ₦${Math.round(total).toLocaleString('en-NG')}`,
      url: '/app?tab=queue',
      actorUserId: user.id,
    });
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  /**
   * Spec §5.2 queue screen: pending items grouped into one lane per payment category (bundles
   * collapsed into one entry), lane totals/counts, the worst over-budget COA badge per lane, and
   * the toolbar counts (urgent, No TIN/phone, rejected).
   */
  async lanes(workspaceId: string, query: QueueQueryDto) {
    const [categories, pending, rejectedCount] = await Promise.all([
      this.prisma.payCategory.findMany({
        where: { workspaceId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, color: true, isActive: true, includeInBudgets: true, sortOrder: true },
      }),
      this.prisma.queueItem.findMany({
        where: { workspaceId, status: 'PENDING' },
        include: ITEM_LIST_INCLUDE,
        orderBy: [{ isUrgent: 'desc' }, { date: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.queueItem.count({ where: { workspaceId, status: 'REJECTED' } }),
    ]);

    const urgentCount = pending.filter((i) => i.isUrgent).length;
    const noTinCount = pending.filter((i) => !hasVendorTinAndPhone(i.vendor)).length;

    const q = query.search?.trim().toLowerCase();
    const visible = pending.filter((i) => {
      if (query.urgentOnly && !i.isUrgent) return false;
      if (query.noTinOnly && hasVendorTinAndPhone(i.vendor)) return false;
      if (!q) return true;
      return [i.vendor.name, i.vendorName, i.description, i.bundleLabel, i.coaTag]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q));
    });

    // Budget badge: utilisation per (BU, P&L month, COA) for budgeted categories.
    const budgetedCats = new Set(categories.filter((c) => c.includeInBudgets).map((c) => c.id));
    const budgetItems = pending.filter((i) => i.payCategoryId && budgetedCats.has(i.payCategoryId) && i.coaTagId && i.pnlPeriod);
    const periods = [...new Set(budgetItems.map((i) => i.pnlPeriod!))];
    const coaIds = [...new Set(budgetItems.map((i) => i.coaTagId!))];
    const utilisation = new Map<string, { pct: number; spent: number; cap: number }>();
    if (periods.length && coaIds.length) {
      const [budgets, spend] = await Promise.all([
        this.prisma.budget.findMany({ where: { workspaceId, periodMonth: { in: periods }, coaTagId: { in: coaIds } } }),
        computeSpend(this.prisma, workspaceId, { periods, coaTagIds: coaIds }),
      ]);
      for (const b of budgets) {
        const cap = toNum(b.monthlyAmount);
        if (cap <= 0) continue;
        const key = spendKey(b.costCenterId, b.periodMonth, b.coaTagId);
        const spent = spend.get(key) ?? 0;
        utilisation.set(key, { pct: Math.round((spent / cap) * 100), spent, cap });
      }
    }

    const mapItem = (i: ListItem) => ({
      id: i.id,
      shortId: i.id.slice(0, 8).toUpperCase(),
      date: i.date,
      vendorId: i.vendorId,
      vendorName: i.vendor.name,
      description: i.description,
      units: toNum(i.units),
      unitName: i.unitName,
      unitAmount: toNum(i.unitAmount),
      total: toNum(i.total),
      whtRate: toNum(i.whtRate),
      whtAmount: toNum(i.whtAmount),
      netAmount: toNum(i.netAmount),
      payCategoryId: i.payCategoryId,
      coaTagId: i.coaTagId,
      coaTag: i.coaTag,
      costCenter: i.costCenter,
      location: i.location,
      pnlPeriod: i.pnlPeriod,
      isUrgent: i.isUrgent,
      bundleId: i.bundleId,
      bundleLabel: i.bundleLabel,
      recurrenceId: i.recurrenceId,
      requisition: i.requisition,
      createdByName: i.createdByName,
      requestedByName: i.requestedByName ?? i.requisition?.requesterName ?? null,
      noTinPhone: !hasVendorTinAndPhone(i.vendor),
      noBankDetails: !i.vendor.bankAccountNumber,
      commentCount: i._count.comments,
      attachmentCount: i._count.attachments,
      createdAt: i.createdAt,
    });

    const lanes = categories
      .filter((c) => c.isActive || visible.some((i) => i.payCategoryId === c.id))
      .map((c) => {
        const laneItems = visible.filter((i) => i.payCategoryId === c.id);
        return this.buildLane(c, laneItems, mapItem, utilisation);
      });
    const uncategorised = visible.filter((i) => !i.payCategoryId || !categories.some((c) => c.id === i.payCategoryId));
    if (uncategorised.length) {
      lanes.push(this.buildLane({ id: null, name: 'Uncategorised', color: '#94A3B8' }, uncategorised, mapItem, utilisation));
    }

    const grandTotal = round2(pending.reduce((s, i) => s + toNum(i.total), 0));
    return {
      grandTotal,
      itemCount: pending.length,
      visibleTotal: round2(visible.reduce((s, i) => s + toNum(i.total), 0)),
      visibleCount: visible.length,
      counts: { urgent: urgentCount, noTinPhone: noTinCount, rejected: rejectedCount },
      lanes,
    };
  }

  private buildLane(
    category: { id: string | null; name: string; color: string },
    items: ListItem[],
    mapItem: (i: ListItem) => ReturnType<QueueService['mapForType']>,
    utilisation: Map<string, { pct: number; spent: number; cap: number }>,
  ) {
    // Group bundles; keep urgent-first ordering of the first appearance.
    const entries: Array<
      | { type: 'item'; isUrgent: boolean; item: ReturnType<QueueService['mapForType']> }
      | {
          type: 'bundle';
          isUrgent: boolean;
          bundleId: string;
          bundleLabel: string | null;
          total: number;
          itemCount: number;
          vendorCount: number;
          coaTags: string[];
          pnlPeriods: string[];
          createdByName: string | null;
          items: ReturnType<QueueService['mapForType']>[];
        }
    > = [];
    const bundleIndex = new Map<string, number>();
    for (const raw of items) {
      const item = mapItem(raw);
      if (!raw.bundleId) {
        entries.push({ type: 'item', isUrgent: raw.isUrgent, item });
        continue;
      }
      let idx = bundleIndex.get(raw.bundleId);
      if (idx === undefined) {
        idx = entries.length;
        bundleIndex.set(raw.bundleId, idx);
        entries.push({
          type: 'bundle',
          isUrgent: false,
          bundleId: raw.bundleId,
          bundleLabel: raw.bundleLabel,
          total: 0,
          itemCount: 0,
          vendorCount: 0,
          coaTags: [],
          pnlPeriods: [],
          createdByName: raw.createdByName,
          items: [],
        });
      }
      const b = entries[idx];
      if (b.type === 'bundle') b.items.push(item);
    }
    for (const e of entries) {
      if (e.type !== 'bundle') continue;
      e.total = round2(e.items.reduce((s, i) => s + i.total, 0));
      e.itemCount = e.items.length;
      e.vendorCount = new Set(e.items.map((i) => i.vendorId)).size;
      e.isUrgent = e.items.some((i) => i.isUrgent);
      e.coaTags = [...new Set(e.items.map((i) => i.coaTag).filter((x): x is string => !!x))];
      e.pnlPeriods = [...new Set(e.items.map((i) => i.pnlPeriod).filter((x): x is string => !!x))];
    }
    entries.sort((a, b) => Number(b.isUrgent) - Number(a.isUrgent));

    let overBudget: { coaTag: string | null; pct: number; spent: number; cap: number; costCenter: string | null; period: string } | null =
      null;
    for (const i of items) {
      if (!i.coaTagId || !i.pnlPeriod) continue;
      const u = utilisation.get(spendKey(i.costCenterId, i.pnlPeriod, i.coaTagId));
      if (u && u.pct > 100 && (!overBudget || u.pct > overBudget.pct)) {
        overBudget = { coaTag: i.coaTag, pct: u.pct, spent: u.spent, cap: u.cap, costCenter: i.costCenter?.name ?? null, period: i.pnlPeriod };
      }
    }

    return {
      payCategoryId: category.id,
      name: category.name,
      color: category.color,
      itemCount: items.length,
      total: round2(items.reduce((s, i) => s + toNum(i.total), 0)),
      overBudget,
      entries,
    };
  }

  /** Type anchor for the mapped list item (never called). */
  private mapForType() {
    return null as unknown as {
      id: string;
      vendorId: string;
      total: number;
      isUrgent: boolean;
      coaTag: string | null;
      pnlPeriod: string | null;
      [key: string]: unknown;
    };
  }

  async listRejected(workspaceId: string, query: QueueQueryDto) {
    const q = query.search?.trim();
    const items = await this.prisma.queueItem.findMany({
      where: {
        workspaceId,
        status: { in: ['REJECTED', 'CANCELLED'] },
        ...(q && {
          OR: [
            { description: { contains: q, mode: 'insensitive' } },
            { vendorName: { contains: q, mode: 'insensitive' } },
            { bundleLabel: { contains: q, mode: 'insensitive' } },
          ],
        }),
      },
      include: ITEM_LIST_INCLUDE,
      orderBy: { rejectedAt: 'desc' },
      take: 500,
    });
    const rejectors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.rejectedById).filter((x): x is string => !!x))] } },
      select: { id: true, displayName: true, firstName: true, lastName: true },
    });
    const nameOf = new Map(rejectors.map((u) => [u.id, u.displayName || `${u.firstName} ${u.lastName}`.trim()]));
    return items.map((i) => ({
      ...i,
      total: toNum(i.total),
      rejectedByName: i.rejectedById ? nameOf.get(i.rejectedById) ?? null : null,
    }));
  }

  async findOne(workspaceId: string, id: string) {
    const item = await this.prisma.queueItem.findFirst({
      where: { id, workspaceId },
      include: {
        vendor: true,
        payCategory: { select: { id: true, name: true, color: true } },
        coaTagRef: { select: { id: true, name: true } },
        costCenter: { select: { id: true, name: true, code: true } },
        location: { select: { id: true, name: true, isGeneral: true } },
        requisition: { select: { id: true, reqRef: true, requesterName: true, reason: true, remarks: true } },
        comments: { orderBy: { createdAt: 'asc' } },
        batchItems: { select: { id: true, batch: { select: { id: true, batchRef: true, approvedByName: true } } } },
      },
    });
    if (!item) throw new NotFoundException('Queue item not found');
    const attachments = item.attachmentGroupId
      ? await this.prisma.queueItemAttachment.findMany({
          where: { workspaceId, attachmentGroupId: item.attachmentGroupId },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const { vendor } = item;
    return {
      ...item,
      // Bank details are read from the register now and snapshotted onto the batch line at approval.
      bankDetails: {
        bankName: vendor.bankName,
        bankCode: vendor.bankCode,
        accountNumber: vendor.bankAccountNumber,
        accountName: vendor.verifiedAccountName ?? vendor.accountName,
        verified: vendor.isBankVerified,
      },
      wht: {
        rate: toNum(item.whtRate),
        amount: toNum(item.whtAmount),
        net: toNum(item.netAmount),
        override: item.whtOverride,
        source: item.whtSource,
      },
      approvedByName: item.batchItems[0]?.batch.approvedByName ?? null,
      batchRef: item.batchItems[0]?.batch.batchRef ?? null,
      attachments,
    };
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(user: CurrentUserData, dto: CreateQueueItemDto) {
    const workspaceId = user.workspaceId;
    this.assertWhtPermission(user, dto.whtRateOverride ?? undefined);
    const ctx = await this.builder.loadContext(this.prisma, workspaceId);
    const { confirmDuplicate, ...line } = dto;
    const built = await this.builder.build(workspaceId, actorOf(user), line, ctx);

    if (!confirmDuplicate) {
      const dups = await this.builder.findDuplicates(this.prisma, workspaceId, built.vendor.id, toNum(built.data.total as number));
      if (dups.length) throw duplicateConflict(dups);
    }

    const item = await this.prisma.$transaction(async (tx) => {
      const created = await tx.queueItem.create({ data: built.data });
      await this.audit.recordTx(
        tx,
        workspaceId,
        user,
        AUDIT_ACTIONS.QUEUE_ITEM_ADDED,
        `${built.vendor.name} · ₦${Math.round(toNum(created.total)).toLocaleString('en-NG')}`,
        { queueItemId: created.id, total: toNum(created.total), duplicateConfirmed: !!confirmDuplicate },
        { type: 'queue_item', id: created.id },
      );
      return created;
    });
    this.notifyAdded(workspaceId, user, 1, toNum(item.total), built.vendor.name);
    return item;
  }

  /** Builds many lines with one lookup context; returns built rows or per-row errors. */
  private async buildMany(user: CurrentUserData, inputs: QueueLineInput[], ctx?: QueueLineContext) {
    const context = ctx ?? (await this.builder.loadContext(this.prisma, user.workspaceId));
    const built: Awaited<ReturnType<QueueLineBuilder['build']>>[] = [];
    const errors: { row: number; error: string }[] = [];
    for (let i = 0; i < inputs.length; i++) {
      try {
        built.push(await this.builder.build(user.workspaceId, actorOf(user), inputs[i], context));
      } catch (error) {
        errors.push({ row: i + 1, error: (error as Error).message });
      }
    }
    return { built, errors };
  }

  private async duplicateRows(workspaceId: string, built: Awaited<ReturnType<QueueLineBuilder['build']>>[]) {
    const rows: { row: number; duplicates: unknown[] }[] = [];
    for (let i = 0; i < built.length; i++) {
      const dups = await this.builder.findDuplicates(this.prisma, workspaceId, built[i].vendor.id, toNum(built[i].data.total as number));
      if (dups.length) rows.push({ row: i + 1, duplicates: dups });
    }
    return rows;
  }

  private async insertMany(
    user: CurrentUserData,
    built: Awaited<ReturnType<QueueLineBuilder['build']>>[],
    audit: { action: string; target: string; metadata: Record<string, unknown> },
  ) {
    const items = await this.prisma.$transaction(
      async (tx) => {
        const created: QueueItem[] = [];
        for (const b of built) created.push(await tx.queueItem.create({ data: b.data }));
        await this.audit.recordTx(tx, user.workspaceId, user, audit.action, audit.target, {
          ...audit.metadata,
          count: created.length,
          total: round2(created.reduce((s, c) => s + toNum(c.total), 0)),
          queueItemIds: created.map((c) => c.id),
        });
        return created;
      },
      { timeout: 30_000, maxWait: 5_000 },
    );
    return items;
  }

  /** Quick-add grid "Save Expenses": all rows valid or nothing is saved. */
  async bulkCreate(user: CurrentUserData, dto: BulkCreateQueueDto) {
    if (dto.rows.some((r) => r.whtRateOverride !== undefined && r.whtRateOverride !== null)) {
      this.assertWhtPermission(user, 1);
    }
    const { built, errors } = await this.buildMany(user, dto.rows);
    if (errors.length) {
      throw new BadRequestException({ message: `${errors.length} row(s) need fixing before saving`, errors: { rows: errors } });
    }
    if (!dto.confirmDuplicates) {
      const dupRows = await this.duplicateRows(user.workspaceId, built);
      if (dupRows.length) throw duplicateConflict(undefined, dupRows);
    }
    const items = await this.insertMany(user, built, {
      action: AUDIT_ACTIONS.QUEUE_ITEM_ADDED,
      target: `Quick add · ${built.length} item(s)`,
      metadata: { source: 'quick_add' },
    });
    const total = items.reduce((s, i) => s + toNum(i.total), 0);
    this.notifyAdded(user.workspaceId, user, items.length, total, 'Quick add');
    return { created: items.length, total: round2(total), items };
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async update(user: CurrentUserData, id: string, dto: UpdateQueueItemDto) {
    const workspaceId = user.workspaceId;
    const existing = await this.getItem(workspaceId, id);
    this.assertEditable(existing);
    if (dto.whtRateOverride !== undefined) this.assertWhtPermission(user, dto.whtRateOverride);

    const input: QueueLineInput = {
      date: dto.date ?? existing.date,
      vendorId: dto.vendorId ?? existing.vendorId,
      description: dto.description ?? existing.description,
      payCategoryId: dto.payCategoryId ?? existing.payCategoryId ?? '',
      coaTagId: dto.coaTagId ?? existing.coaTagId ?? '',
      costCenterId: dto.costCenterId !== undefined ? dto.costCenterId : existing.costCenterId,
      locationId: dto.locationId !== undefined ? dto.locationId : existing.locationId,
      units: dto.units ?? toNum(existing.units),
      unitName: dto.unitName !== undefined ? dto.unitName : existing.unitName,
      unitAmount: dto.unitAmount ?? toNum(existing.unitAmount),
      pnlPeriod: dto.pnlPeriod ?? existing.pnlPeriod,
      isUrgent: dto.isUrgent ?? existing.isUrgent,
      whtRateOverride:
        dto.whtRateOverride !== undefined ? dto.whtRateOverride : existing.whtOverride ? toNum(existing.whtRate) : null,
      bundleId: existing.bundleId,
      bundleLabel: dto.bundleLabel ?? existing.bundleLabel,
      recurrenceId: existing.recurrenceId,
      requisitionId: existing.requisitionId,
      sourceInvoiceId: existing.sourceInvoiceId,
      attachmentGroupId: existing.attachmentGroupId,
      requestedByName: existing.requestedByName,
      invoiceNumber: existing.invoiceNumber,
      invoiceDate: existing.invoiceDate,
    };
    const ctx = await this.builder.loadContext(this.prisma, workspaceId);
    const built = await this.builder.build(workspaceId, actorOf(user), input, ctx);
    if (existing.whtOverride && dto.whtRateOverride === undefined) {
      built.data.whtSource = existing.whtSource; // keep the original override label
    }

    const oldTotal = toNum(existing.total);
    const newTotal = toNum(built.data.total as number);
    const amountChanged = Math.abs(oldTotal - newTotal) >= 0.005;
    const reason = dto.amountChangeReason?.trim();
    if (amountChanged && (!reason || reason.length < 2)) {
      throw new BadRequestException('A reason is required when the amount changes');
    }

    const { workspaceId: _w, createdById: _c, createdByName: _n, status: _s, ...changes } = built.data;
    void _w;
    void _c;
    void _n;
    void _s;

    const changedFields = (Object.keys(changes) as (keyof typeof changes)[]).filter((k) => {
      const before = (existing as Record<string, unknown>)[k as string];
      const after = changes[k];
      const norm = (v: unknown) =>
        v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? null : String(Number.isNaN(Number(v)) ? v : Number(v));
      return norm(before) !== norm(after);
    });

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.queueItem.update({ where: { id }, data: changes });
      if (existing.bundleId && dto.bundleLabel && dto.bundleLabel !== existing.bundleLabel) {
        await tx.queueItem.updateMany({
          where: { workspaceId, bundleId: existing.bundleId, status: { in: ['PENDING', 'REJECTED'] } },
          data: { bundleLabel: dto.bundleLabel },
        });
      }
      if (changedFields.length) {
        await this.audit.recordTx(tx, workspaceId, user, AUDIT_ACTIONS.QUEUE_ITEM_UPDATED, updated.vendorName ?? updated.id, {
          queueItemId: id,
          fields: changedFields,
        }, { type: 'queue_item', id });
      }
      if (amountChanged) {
        await this.audit.recordTx(
          tx,
          workspaceId,
          user,
          AUDIT_ACTIONS.QUEUE_ITEM_AMOUNT_CHANGED,
          `${updated.vendorName ?? ''} · ₦${Math.round(oldTotal).toLocaleString('en-NG')} → ₦${Math.round(newTotal).toLocaleString('en-NG')}`,
          { queueItemId: id, oldAmount: oldTotal, newAmount: newTotal, reason },
          { type: 'queue_item', id },
        );
      }
      return updated;
    });
  }

  // ─── Bundles ──────────────────────────────────────────────────────────────

  async createBundle(user: CurrentUserData, dto: CreateBundleDto) {
    if (dto.whtRateOverride !== undefined) this.assertWhtPermission(user, dto.whtRateOverride);
    const bundleId = randomUUID();
    const label = dto.bundleLabel.trim();
    const inputs: QueueLineInput[] = dto.items.map((it) => ({
      date: dto.date,
      vendorId: it.vendorId,
      description: it.description,
      units: it.units,
      unitName: it.unitName,
      unitAmount: it.unitAmount,
      payCategoryId: dto.payCategoryId,
      coaTagId: dto.coaTagId,
      costCenterId: dto.costCenterId,
      locationId: dto.locationId,
      pnlPeriod: dto.pnlPeriod,
      isUrgent: dto.isUrgent,
      whtRateOverride: dto.whtRateOverride,
      bundleId,
      bundleLabel: label,
    }));
    const { built, errors } = await this.buildMany(user, inputs);
    if (errors.length) {
      throw new BadRequestException({ message: `${errors.length} bundle row(s) need fixing`, errors: { rows: errors } });
    }
    if (!dto.confirmDuplicate) {
      const dupRows = await this.duplicateRows(user.workspaceId, built);
      if (dupRows.length) throw duplicateConflict(undefined, dupRows);
    }
    const items = await this.insertMany(user, built, {
      action: AUDIT_ACTIONS.QUEUE_ITEM_ADDED,
      target: `Bundle · ${label}`,
      metadata: { source: 'bundle', bundleId, bundleLabel: label },
    });
    const total = items.reduce((s, i) => s + toNum(i.total), 0);
    this.notifyAdded(user.workspaceId, user, items.length, total, `Bundle ${label}`);
    return { bundleId, bundleLabel: label, total: round2(total), items };
  }

  private async bundleTemplate(workspaceId: string, bundleId: string) {
    const template = await this.prisma.queueItem.findFirst({
      where: { workspaceId, bundleId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    if (!template) throw new NotFoundException('Bundle not found (or it has no pending items)');
    return template;
  }

  /** New sub-items inherit the bundle's date, category, COA, BU, head and P&L period. */
  async addBundleItems(user: CurrentUserData, bundleId: string, dto: AddBundleItemsDto) {
    const t = await this.bundleTemplate(user.workspaceId, bundleId);
    const inputs: QueueLineInput[] = dto.items.map((it) => ({
      date: t.date,
      vendorId: it.vendorId,
      description: it.description,
      units: it.units,
      unitName: it.unitName,
      unitAmount: it.unitAmount,
      payCategoryId: t.payCategoryId ?? '',
      coaTagId: t.coaTagId ?? '',
      costCenterId: t.costCenterId,
      locationId: t.locationId,
      pnlPeriod: t.pnlPeriod,
      isUrgent: t.isUrgent,
      whtRateOverride: t.whtOverride ? toNum(t.whtRate) : null,
      bundleId,
      bundleLabel: t.bundleLabel,
    }));
    const { built, errors } = await this.buildMany(user, inputs);
    if (errors.length) {
      throw new BadRequestException({ message: `${errors.length} row(s) need fixing`, errors: { rows: errors } });
    }
    if (!dto.confirmDuplicate) {
      const dupRows = await this.duplicateRows(user.workspaceId, built);
      if (dupRows.length) throw duplicateConflict(undefined, dupRows);
    }
    const items = await this.insertMany(user, built, {
      action: AUDIT_ACTIONS.QUEUE_ITEM_ADDED,
      target: `Bundle · ${t.bundleLabel ?? bundleId}`,
      metadata: { source: 'bundle_add', bundleId },
    });
    const total = items.reduce((s, i) => s + toNum(i.total), 0);
    this.notifyAdded(user.workspaceId, user, items.length, total, `Bundle ${t.bundleLabel ?? ''}`.trim());
    return { bundleId, items };
  }

  async renameBundle(user: CurrentUserData, bundleId: string, bundleLabel: string) {
    const label = bundleLabel.trim();
    const res = await this.prisma.$transaction(async (tx) => {
      const r = await tx.queueItem.updateMany({
        where: { workspaceId: user.workspaceId, bundleId, status: { in: ['PENDING', 'REJECTED'] } },
        data: { bundleLabel: label },
      });
      if (!r.count) throw new NotFoundException('Bundle not found');
      await this.audit.recordTx(tx, user.workspaceId, user, AUDIT_ACTIONS.QUEUE_ITEM_UPDATED, `Bundle · ${label}`, {
        bundleId,
        fields: ['bundleLabel'],
        count: r.count,
      });
      return r;
    });
    return { bundleId, bundleLabel: label, updated: res.count };
  }

  async setBundleUrgent(user: CurrentUserData, bundleId: string, isUrgent: boolean) {
    const res = await this.prisma.$transaction(async (tx) => {
      const r = await tx.queueItem.updateMany({
        where: { workspaceId: user.workspaceId, bundleId, status: 'PENDING' },
        data: { isUrgent },
      });
      if (!r.count) throw new NotFoundException('Bundle not found');
      await this.audit.recordTx(tx, user.workspaceId, user, AUDIT_ACTIONS.QUEUE_ITEM_UPDATED, `Bundle urgent → ${isUrgent}`, {
        bundleId,
        fields: ['isUrgent'],
        isUrgent,
        count: r.count,
      });
      return r;
    });
    return { bundleId, isUrgent, updated: res.count };
  }

  async deleteBundle(user: CurrentUserData, bundleId: string) {
    const workspaceId = user.workspaceId;
    return this.prisma.$transaction(async (tx) => {
      const items = await tx.queueItem.findMany({
        where: { workspaceId, bundleId, status: { not: 'APPROVED' } },
        select: { id: true, total: true, requisitionId: true, bundleLabel: true },
      });
      if (!items.length) throw new NotFoundException('Bundle not found (approved lines cannot be deleted)');
      await tx.queueItem.deleteMany({ where: { workspaceId, id: { in: items.map((i) => i.id) } } });
      await this.releaseRequisitions(tx, workspaceId, items.map((i) => i.requisitionId));
      await this.audit.recordTx(tx, workspaceId, user, AUDIT_ACTIONS.QUEUE_ITEM_DELETED, `Bundle · ${items[0].bundleLabel ?? bundleId}`, {
        bundleId,
        queueItemIds: items.map((i) => i.id),
        total: round2(items.reduce((s, i) => s + toNum(i.total), 0)),
      });
      return { bundleId, deleted: items.length };
    });
  }

  // ─── Split / reject / restore / delete ──────────────────────────────────────

  /** Splits one line into N lines (even or custom amounts); the new lines replace the original. */
  async split(user: CurrentUserData, id: string, dto: SplitQueueItemDto) {
    const workspaceId = user.workspaceId;
    const item = await this.getItem(workspaceId, id);
    if (item.status !== 'PENDING') throw new ConflictException('Only pending items can be split');
    const total = toNum(item.total);

    let parts: { amount: number; description?: string }[];
    if (dto.lines?.length) {
      parts = dto.lines.map((l) => ({ amount: round2(l.amount), description: l.description?.trim() || undefined }));
      const sum = round2(parts.reduce((s, p) => s + p.amount, 0));
      if (Math.abs(sum - total) > 0.01) {
        throw new BadRequestException(`Split amounts add up to ₦${sum.toLocaleString('en-NG')}, but the line total is ₦${total.toLocaleString('en-NG')}`);
      }
    } else {
      const n = Math.floor(dto.parts ?? 2);
      if (n < 2) throw new BadRequestException('Split into at least 2 lines');
      const base = Math.floor((total * 100) / n) / 100;
      parts = Array.from({ length: n }, (_, i) => ({ amount: i === n - 1 ? round2(total - base * (n - 1)) : base }));
    }
    if (parts.some((p) => p.amount <= 0)) throw new BadRequestException('Every split line needs an amount above 0');

    const rate = toNum(item.whtRate);
    return this.prisma.$transaction(async (tx) => {
      const created: QueueItem[] = [];
      for (const p of parts) {
        const { wht, net } = computeWht(p.amount, rate);
        created.push(
          await tx.queueItem.create({
            data: {
              workspaceId,
              date: item.date,
              vendorId: item.vendorId,
              vendorName: item.vendorName,
              description: p.description ?? item.description,
              units: 1,
              unitName: item.unitName,
              unitAmount: p.amount,
              total: p.amount,
              whtRate: rate,
              whtAmount: wht,
              netAmount: net,
              whtOverride: item.whtOverride,
              whtSource: item.whtSource,
              payCategoryId: item.payCategoryId,
              payCategoryName: item.payCategoryName,
              coaTagId: item.coaTagId,
              coaTag: item.coaTag,
              costCenterId: item.costCenterId,
              locationId: item.locationId,
              pnlPeriod: item.pnlPeriod,
              isUrgent: item.isUrgent,
              bundleId: item.bundleId,
              bundleLabel: item.bundleLabel,
              recurrenceId: item.recurrenceId,
              sourceInvoiceId: item.sourceInvoiceId,
              attachmentGroupId: item.attachmentGroupId,
              invoiceNumber: item.invoiceNumber,
              invoiceDate: item.invoiceDate,
              requestedByName: item.requestedByName,
              createdById: item.createdById,
              createdByName: item.createdByName,
              status: 'PENDING',
            },
          }),
        );
      }
      const first = created[0];
      await tx.queueItemComment.updateMany({ where: { queueItemId: id }, data: { queueItemId: first.id } });
      await tx.queueItemAttachment.updateMany({ where: { workspaceId, queueItemId: id }, data: { queueItemId: first.id } });
      await tx.queueItem.delete({ where: { id } });
      if (item.requisitionId) {
        await tx.queueItem.update({ where: { id: first.id }, data: { requisitionId: item.requisitionId } });
      }
      await this.audit.recordTx(tx, workspaceId, user, AUDIT_ACTIONS.QUEUE_ITEM_SPLIT, `${item.vendorName ?? ''} · ${parts.length} lines`, {
        originalId: id,
        originalTotal: total,
        newIds: created.map((c) => c.id),
        amounts: parts.map((p) => p.amount),
      }, { type: 'queue_item', id });
      return { originalId: id, items: created };
    });
  }

  async reject(user: CurrentUserData, id: string, dto: RejectQueueItemDto) {
    const workspaceId = user.workspaceId;
    const item = await this.getItem(workspaceId, id);
    if (item.status !== 'PENDING') throw new ConflictException(`Only pending items can be rejected (this one is ${item.status})`);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.queueItem.update({
        where: { id },
        data: { status: 'REJECTED', rejectedReason: dto.reason.trim(), rejectedById: user.id, rejectedAt: new Date() },
      });
      await this.audit.recordTx(tx, workspaceId, user, AUDIT_ACTIONS.QUEUE_ITEM_REJECTED, `${item.vendorName ?? ''} · ₦${Math.round(toNum(item.total)).toLocaleString('en-NG')}`, {
        queueItemId: id,
        reason: dto.reason.trim(),
        total: toNum(item.total),
      }, { type: 'queue_item', id });
      return updated;
    });
  }

  async restore(user: CurrentUserData, id: string) {
    const workspaceId = user.workspaceId;
    const item = await this.getItem(workspaceId, id);
    if (item.status !== 'REJECTED' && item.status !== 'CANCELLED') throw new ConflictException('Only rejected items can be restored');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.queueItem.update({
        where: { id },
        data: { status: 'PENDING', rejectedReason: null, rejectedById: null, rejectedAt: null },
      });
      await this.audit.recordTx(tx, workspaceId, user, AUDIT_ACTIONS.QUEUE_ITEM_RESTORED, `${item.vendorName ?? ''} · ₦${Math.round(toNum(item.total)).toLocaleString('en-NG')}`, {
        queueItemId: id,
        previousReason: item.rejectedReason,
      }, { type: 'queue_item', id });
      return updated;
    });
  }

  /** Hard delete for genuine mistakes. Approved (batched) items can't be deleted. */
  async remove(user: CurrentUserData, id: string) {
    const workspaceId = user.workspaceId;
    const item = await this.getItem(workspaceId, id);
    this.assertEditable(item);
    await this.prisma.$transaction(async (tx) => {
      await tx.queueItem.delete({ where: { id } });
      await this.releaseRequisitions(tx, workspaceId, [item.requisitionId]);
      await this.audit.recordTx(tx, workspaceId, user, AUDIT_ACTIONS.QUEUE_ITEM_DELETED, `${item.vendorName ?? ''} · ₦${Math.round(toNum(item.total)).toLocaleString('en-NG')}`, {
        queueItemId: id,
        total: toNum(item.total),
        description: item.description,
        status: item.status,
      }, { type: 'queue_item', id });
    });
    return { success: true };
  }

  // ─── CSV ──────────────────────────────────────────────────────────────────

  async csvTemplate(workspaceId: string): Promise<string> {
    const [vendor, coa, bu] = await Promise.all([
      this.prisma.vendor.findFirst({ where: { workspaceId, isActive: true, bankAccountNumber: { not: null } }, orderBy: { name: 'asc' } }),
      this.prisma.coaTag.findFirst({ where: { workspaceId, isActive: true }, include: { payCategory: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.costCenter.findFirst({ where: { workspaceId, isActive: true }, include: { locations: { take: 1 } }, orderBy: { sortOrder: 'asc' } }),
    ]);
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const sample = [
      `${today.getFullYear()}-${mm}-${dd}`,
      vendor?.name ?? 'Exact Vendor Name',
      `Diesel – Generator – 200L – ${dd}/${mm}/${today.getFullYear()}`,
      coa?.payCategory.name ?? 'OPEX',
      coa?.name ?? 'COA tag',
      bu?.name ?? '',
      bu?.locations[0]?.name ?? '',
      '200',
      'Litre',
      '1250',
      `${today.getFullYear()}-${mm}`,
      'no',
    ];
    return [QUEUE_CSV_COLUMNS.join(','), sample.map(csvEscape).join(',')].join('\n') + '\n';
  }

  private async analyseCsv(user: CurrentUserData, csv: string) {
    const workspaceId = user.workspaceId;
    const rows = parseCsvText(csv);
    if (rows.length < 2) throw new BadRequestException('The CSV needs a header row and at least one data row');
    const header = rows[0].map((h) => QUEUE_CSV_ALIASES[headerKey(h)] ?? null);
    const col = (field: string) => header.indexOf(field);
    const missing = ['vendor', 'description', 'category'].filter((f) => col(f) === -1);
    if (col('unitAmount') === -1 && col('amount') === -1) missing.push('unit amount');
    if (missing.length) throw new BadRequestException(`CSV is missing column(s): ${missing.join(', ')}`);

    const ctx = await this.builder.loadContext(this.prisma, workspaceId);
    const lc = (s: string) => s.trim().toLowerCase();
    const vendorsByName = new Map([...ctx.vendors.values()].map((v) => [lc(v.name), v]));
    const catsByName = new Map([...ctx.categories.values()].map((c) => [lc(c.name), c]));
    const coaByKey = new Map([...ctx.coaTags.values()].map((c) => [`${c.payCategoryId}|${lc(c.name)}`, c]));
    const buByName = new Map<string, string>();
    for (const b of ctx.costCenters.values()) {
      buByName.set(lc(b.name), b.id);
      if (b.code) buByName.set(lc(b.code), b.id);
    }
    const headByKey = new Map([...ctx.locations.values()].map((l) => [`${l.costCenterId ?? ''}|${lc(l.name)}`, l.id]));

    const preview: CsvPreviewRow[] = [];
    const builtByRow = new Map<number, Awaited<ReturnType<QueueLineBuilder['build']>>>();
    const actor = actorOf(user);

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      const get = (f: string) => (col(f) >= 0 ? (cells[col(f)] ?? '').trim() : '');
      const notes: string[] = [];
      const vendorName = get('vendor');
      const description = get('description');
      const categoryName = get('category');
      const coaName = get('coa');
      const unitsRaw = get('units');
      const units = unitsRaw ? parseCsvAmount(unitsRaw) : 1;
      let unitAmount = parseCsvAmount(get('unitAmount'));
      const amount = parseCsvAmount(get('amount'));
      if (unitAmount === null && amount !== null && units) unitAmount = round2(amount / units);
      const rowNo = r + 1;
      const out: CsvPreviewRow = {
        row: rowNo,
        status: 'ok',
        date: get('date') || null,
        vendor: vendorName,
        description,
        category: categoryName,
        coa: coaName,
        units,
        unitAmount,
        amount: units !== null && unitAmount !== null ? round2(units * unitAmount) : amount,
        notes,
      };

      const vendor = vendorName ? vendorsByName.get(lc(vendorName)) : undefined;
      if (!vendorName) notes.push('Vendor is required');
      else if (!vendor) notes.push(`Vendor "${vendorName}" not found — it must match a name in the Vendor Register exactly`);
      const category = categoryName ? catsByName.get(lc(categoryName)) : undefined;
      if (!categoryName) notes.push('Category is required');
      else if (!category) notes.push(`Category "${categoryName}" not found — it must match a payment category name exactly`);
      const coa = category && coaName ? coaByKey.get(`${category.id}|${lc(coaName)}`) : undefined;
      if (!coaName) notes.push('COA is required');
      else if (category && !coa) notes.push(`COA "${coaName}" is not a tag of ${category.name}`);
      if (units === null || units <= 0) notes.push('Units must be a number above 0');
      if (unitAmount === null || unitAmount <= 0) notes.push('Amount must be a number above 0');

      let costCenterId: string | null = null;
      const buName = get('bu');
      if (buName) {
        costCenterId = buByName.get(lc(buName)) ?? null;
        if (!costCenterId) notes.push(`Business Unit "${buName}" not found`);
      }
      let locationId: string | null = null;
      const headName = get('head');
      if (headName) {
        locationId = headByKey.get(`${costCenterId ?? ''}|${lc(headName)}`) ?? null;
        if (!locationId) notes.push(`BU Head "${headName}" not found${buName ? ` under ${buName}` : ''}`);
      }
      let pnlPeriod: string | null = get('pnlPeriod') || null;
      if (pnlPeriod) {
        const my = /^(\d{1,2})[/-](\d{4})$/.exec(pnlPeriod);
        if (my) pnlPeriod = `${my[2]}-${my[1].padStart(2, '0')}`;
        if (!PERIOD_PATTERN.test(pnlPeriod)) notes.push('Activity Month must be YYYY-MM');
      }
      let date: Date | null = null;
      if (out.date) {
        try {
          date = toDateOnly(out.date);
        } catch {
          notes.push(`Invalid date "${out.date}"`);
        }
      }

      if (!notes.length && vendor && category && coa && units && unitAmount) {
        try {
          const built = await this.builder.build(
            workspaceId,
            actor,
            {
              date,
              vendorId: vendor.id,
              description,
              payCategoryId: category.id,
              coaTagId: coa.id,
              costCenterId,
              locationId,
              units,
              unitName: get('unitName') || null,
              unitAmount,
              pnlPeriod,
              isUrgent: ['yes', 'y', 'true', '1', 'urgent'].includes(lc(get('urgent'))),
            },
            ctx,
          );
          builtByRow.set(rowNo, built);
          const dups = await this.builder.findDuplicates(this.prisma, workspaceId, vendor.id, toNum(built.data.total as number));
          if (dups.length) {
            out.status = 'duplicate';
            notes.push(`Possible duplicate: same vendor and amount within 7 days (${dups.length} match${dups.length > 1 ? 'es' : ''})`);
          }
        } catch (error) {
          notes.push((error as Error).message);
        }
      }
      if (!builtByRow.has(rowNo)) out.status = 'error';
      preview.push(out);
    }

    return { preview, builtByRow };
  }

  async csvPreview(user: CurrentUserData, dto: CsvTextDto) {
    const { preview } = await this.analyseCsv(user, dto.csv);
    return {
      rows: preview,
      summary: {
        total: preview.length,
        ok: preview.filter((r) => r.status === 'ok').length,
        duplicates: preview.filter((r) => r.status === 'duplicate').length,
        errors: preview.filter((r) => r.status === 'error').length,
        importableTotal: round2(preview.filter((r) => r.status !== 'error').reduce((s, r) => s + (r.amount ?? 0), 0)),
      },
    };
  }

  /** Imports valid rows (and flagged duplicates only when confirmed). Error rows are skipped. */
  async csvImport(user: CurrentUserData, dto: CsvTextDto) {
    const { preview, builtByRow } = await this.analyseCsv(user, dto.csv);
    const toImport = preview.filter((r) => r.status === 'ok' || (r.status === 'duplicate' && dto.confirmDuplicates));
    if (!toImport.length) {
      throw new BadRequestException({ message: 'No rows can be imported', errors: { rows: preview } });
    }
    const built = toImport.map((r) => builtByRow.get(r.row)!);
    const items = await this.insertMany(user, built, {
      action: AUDIT_ACTIONS.QUEUE_CSV_UPLOADED,
      target: `CSV upload · ${built.length} item(s)`,
      metadata: {
        rowsInFile: preview.length,
        skippedErrors: preview.filter((r) => r.status === 'error').length,
        skippedDuplicates: preview.filter((r) => r.status === 'duplicate' && !dto.confirmDuplicates).length,
      },
    });
    const total = items.reduce((s, i) => s + toNum(i.total), 0);
    this.notifyAdded(user.workspaceId, user, items.length, total, 'CSV upload');
    return {
      imported: items.length,
      skipped: preview.length - items.length,
      total: round2(total),
      rows: preview.map((r) => ({ ...r, imported: toImport.includes(r) })),
    };
  }

  // ─── Comments ─────────────────────────────────────────────────────────────

  async addComment(user: CurrentUserData, queueItemId: string, dto: AddCommentDto) {
    const item = await this.getItem(user.workspaceId, queueItemId);
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.queueItemComment.create({
        data: { queueItemId, userId: user.id, authorName: actorOf(user).displayName, body: dto.body.trim() },
      });
      await this.audit.recordTx(tx, user.workspaceId, user, AUDIT_ACTIONS.QUEUE_COMMENT_ADDED, item.vendorName ?? item.id, {
        queueItemId,
        commentId: comment.id,
      }, { type: 'queue_item', id: queueItemId });
      return comment;
    });
  }

  async listComments(workspaceId: string, queueItemId: string) {
    await this.getItem(workspaceId, queueItemId);
    return this.prisma.queueItemComment.findMany({
      where: { queueItemId },
      include: { user: { select: { id: true, displayName: true, firstName: true, lastName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Ensures the item has an attachment group (shared with its requisition, if any). */
  async ensureAttachmentGroup(workspaceId: string, queueItemId: string): Promise<string> {
    const item = await this.getItem(workspaceId, queueItemId);
    if (item.attachmentGroupId) return item.attachmentGroupId;
    const attachmentGroupId = randomUUID();
    await this.prisma.queueItem.update({ where: { id: item.id }, data: { attachmentGroupId } });
    return attachmentGroupId;
  }
}
