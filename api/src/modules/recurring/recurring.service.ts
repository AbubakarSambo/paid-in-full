import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, RecurringPayment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, AuditActor } from '../platform/audit-log.service';
import { AUDIT_ACTIONS } from '../../common/audit-actions';
import { NotifyBridge, QueueLineBuilder, vendorHasBankDetails } from '../queue/queue-core';
import { CreateRecurringPaymentDto, UpdateRecurringPaymentDto } from './dto';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Spec §5.2: a recurring payment appears in the queue 7 days before its due date. */
export const LEAD_DAYS = 7;
/** If the daily job was missed, still enqueue up to this many days after the due date. */
const CATCH_UP_DAYS = 7;

function utcToday(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

/** Due date in a month; days 29–31 clamp to the month's last day. */
export function dueDateIn(year: number, monthIdx: number, dayOfMonth: number): Date {
  const last = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIdx, Math.min(dayOfMonth, last)));
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function ddmmyyyy(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

/** Next due date on or after `from`. */
export function nextDueDate(dayOfMonth: number, from = utcToday()): Date {
  const thisMonth = dueDateIn(from.getUTCFullYear(), from.getUTCMonth(), dayOfMonth);
  if (thisMonth >= from) return thisMonth;
  return dueDateIn(from.getUTCFullYear(), from.getUTCMonth() + 1, dayOfMonth);
}

export interface RecurringRunResult {
  queued: number;
  skippedNoBank: number;
  errors?: { recurringPaymentId: string; description: string; error: string }[];
}

const RECURRING_INCLUDE = {
  vendor: { select: { id: true, name: true, bankName: true, bankCode: true, bankAccountNumber: true } },
  payCategory: { select: { id: true, name: true, color: true } },
  coaTag: { select: { id: true, name: true } },
  costCenter: { select: { id: true, name: true, code: true } },
  location: { select: { id: true, name: true } },
} satisfies Prisma.RecurringPaymentInclude;

@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly builder: QueueLineBuilder,
    private readonly notifier: NotifyBridge,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────

  private decorate<T extends RecurringPayment & { vendor: { bankName: string | null; bankCode: string | null; bankAccountNumber: string | null } }>(p: T) {
    const due = nextDueDate(p.dayOfMonth);
    return {
      ...p,
      nextDueDate: due,
      nextQueueDate: new Date(due.getTime() - LEAD_DAYS * DAY_MS),
      vendorHasBankDetails: vendorHasBankDetails(p.vendor),
    };
  }

  async list(workspaceId: string) {
    const rows = await this.prisma.recurringPayment.findMany({
      where: { workspaceId },
      include: RECURRING_INCLUDE,
      orderBy: [{ isActive: 'desc' }, { dayOfMonth: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.decorate(r));
  }

  private async findOrThrow(workspaceId: string, id: string) {
    const row = await this.prisma.recurringPayment.findFirst({ where: { id, workspaceId } });
    if (!row) throw new NotFoundException('Recurring payment not found');
    return row;
  }

  private async validateRefs(
    workspaceId: string,
    refs: { vendorId: string; payCategoryId: string | null; coaTagId: string | null; costCenterId: string | null; locationId: string | null },
  ) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id: refs.vendorId, workspaceId } });
    if (!vendor) throw new BadRequestException('Vendor not found in the Vendor Register');
    if (!refs.payCategoryId) throw new BadRequestException('Payment category is required');
    if (!refs.coaTagId) throw new BadRequestException('COA tag is required');
    const category = await this.prisma.payCategory.findFirst({ where: { id: refs.payCategoryId, workspaceId } });
    if (!category) throw new BadRequestException('Payment category not found');
    const coa = await this.prisma.coaTag.findFirst({ where: { id: refs.coaTagId, workspaceId } });
    if (!coa) throw new BadRequestException('COA tag not found');
    // TODO(coa-tags): switch to the shared assertCoaBelongsToCategory helper once it lands.
    if (coa.payCategoryId !== category.id) {
      throw new BadRequestException(`COA "${coa.name}" does not belong to category "${category.name}"`);
    }
    if (refs.costCenterId) {
      const bu = await this.prisma.costCenter.findFirst({ where: { id: refs.costCenterId, workspaceId } });
      if (!bu) throw new BadRequestException('Business Unit not found');
    }
    if (refs.locationId) {
      const loc = await this.prisma.location.findFirst({ where: { id: refs.locationId, workspaceId } });
      if (!loc) throw new BadRequestException('BU Head not found');
      if (refs.costCenterId && loc.costCenterId && loc.costCenterId !== refs.costCenterId) {
        throw new BadRequestException('BU Head does not belong to the selected Business Unit');
      }
    }
  }

  async create(workspaceId: string, userId: string, dto: CreateRecurringPaymentDto) {
    const refs = {
      vendorId: dto.vendorId,
      payCategoryId: dto.payCategoryId,
      coaTagId: dto.coaTagId,
      costCenterId: dto.costCenterId ?? null,
      locationId: dto.locationId ?? null,
    };
    await this.validateRefs(workspaceId, refs);
    const due = nextDueDate(dto.dayOfMonth);
    const row = await this.prisma.recurringPayment.create({
      data: {
        workspaceId,
        ...refs,
        description: dto.description.trim(),
        amount: dto.amount,
        dayOfMonth: dto.dayOfMonth,
        urgentDays: dto.urgentDays ?? 2,
        isActive: dto.isActive ?? true,
        nextRunDate: new Date(due.getTime() - LEAD_DAYS * DAY_MS),
        createdById: userId,
      },
      include: RECURRING_INCLUDE,
    });
    return this.decorate(row);
  }

  async update(workspaceId: string, id: string, dto: UpdateRecurringPaymentDto) {
    const existing = await this.findOrThrow(workspaceId, id);
    const refs = {
      vendorId: dto.vendorId ?? existing.vendorId,
      payCategoryId: dto.payCategoryId !== undefined ? dto.payCategoryId : existing.payCategoryId,
      coaTagId: dto.coaTagId !== undefined ? dto.coaTagId : existing.coaTagId,
      costCenterId: dto.costCenterId !== undefined ? dto.costCenterId ?? null : existing.costCenterId,
      locationId: dto.locationId !== undefined ? dto.locationId ?? null : existing.locationId,
    };
    await this.validateRefs(workspaceId, refs);
    const dayOfMonth = dto.dayOfMonth ?? existing.dayOfMonth;
    const due = nextDueDate(dayOfMonth);
    const row = await this.prisma.recurringPayment.update({
      where: { id: existing.id },
      data: {
        ...refs,
        ...(dto.description !== undefined && { description: dto.description.trim() }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.urgentDays !== undefined && { urgentDays: dto.urgentDays }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        dayOfMonth,
        nextRunDate: new Date(due.getTime() - LEAD_DAYS * DAY_MS),
      },
      include: RECURRING_INCLUDE,
    });
    return this.decorate(row);
  }

  async remove(workspaceId: string, id: string) {
    const existing = await this.findOrThrow(workspaceId, id);
    // Queue items already created keep their history (recurrenceId is SetNull on delete).
    await this.prisma.recurringPayment.delete({ where: { id: existing.id } });
    return { success: true };
  }

  // ─── run (spec run_recurring_payments) ─────────────────────────────────

  /**
   * The due date this payment should be queued for today, if any: this month's or next month's due
   * date when today is within the 7-day lead window, or a recent past-due date the job missed.
   */
  private dueDateToQueue(p: RecurringPayment, today: Date): Date | null {
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    const candidates = [dueDateIn(y, m - 1, p.dayOfMonth), dueDateIn(y, m, p.dayOfMonth), dueDateIn(y, m + 1, p.dayOfMonth)];
    for (const due of candidates) {
      const windowStart = due.getTime() - LEAD_DAYS * DAY_MS;
      if (today.getTime() < windowStart) continue;
      if (today.getTime() <= due.getTime()) return due;
      // Past due: catch up only for a missed run, and only if the payment existed in the window.
      const late = (today.getTime() - due.getTime()) / DAY_MS;
      if (late <= CATCH_UP_DAYS && p.createdAt.getTime() <= due.getTime()) return due;
    }
    return null;
  }

  private async fallbackCreatorId(workspaceId: string): Promise<string | null> {
    const admin = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, role: 'ADMIN', isActive: true },
      orderBy: { invitedAt: 'asc' },
      select: { userId: true },
    });
    return admin?.userId ?? null;
  }

  /**
   * Enqueues every due recurring payment in the workspace. Idempotent per period: a payment is
   * never queued twice for the same due month (QueueItem.recurrenceId + pnlPeriod, checked under a
   * row lock on the recurring payment). Nothing is paid automatically; items still need approval.
   */
  async run(workspaceId: string, actor: AuditActor, requestingUserId?: string): Promise<RecurringRunResult> {
    const today = utcToday();
    const payments = await this.prisma.recurringPayment.findMany({ where: { workspaceId, isActive: true } });
    const result: RecurringRunResult = { queued: 0, skippedNoBank: 0 };
    const errors: NonNullable<RecurringRunResult['errors']> = [];
    if (payments.length === 0) return result;

    const ctx = await this.builder.loadContext(this.prisma, workspaceId);
    let fallbackId: string | null | undefined;
    const created: { id: string; vendorName: string | null; total: number; description: string }[] = [];

    for (const p of payments) {
      const due = this.dueDateToQueue(p, today);
      if (!due) continue;
      const period = monthKey(due);

      const vendor = ctx.vendors.get(p.vendorId);
      if (vendor && !vendorHasBankDetails(vendor)) {
        // Only count it once per period: skip silently if already queued.
        const already = await this.prisma.queueItem.findFirst({ where: { workspaceId, recurrenceId: p.id, pnlPeriod: period } });
        if (!already) result.skippedNoBank++;
        continue;
      }

      let creatorId = p.createdById ?? requestingUserId ?? null;
      if (!creatorId) {
        if (fallbackId === undefined) fallbackId = await this.fallbackCreatorId(workspaceId);
        creatorId = fallbackId;
      }
      const description = `${p.description} – ${ddmmyyyy(due)}`;
      if (!creatorId) {
        errors.push({ recurringPaymentId: p.id, description, error: 'No user to attribute the queue item to' });
        continue;
      }

      try {
        const daysToDue = Math.round((due.getTime() - today.getTime()) / DAY_MS);
        const built = await this.builder.build(
          workspaceId,
          { id: creatorId, displayName: 'Recurring' },
          {
            date: today,
            vendorId: p.vendorId,
            description,
            payCategoryId: p.payCategoryId ?? '',
            coaTagId: p.coaTagId ?? '',
            costCenterId: p.costCenterId,
            locationId: p.locationId,
            units: 1,
            unitAmount: Number(p.amount),
            pnlPeriod: period,
            isUrgent: daysToDue <= p.urgentDays,
            recurrenceId: p.id,
          },
          ctx,
        );

        const item = await this.prisma.$transaction(async (tx) => {
          // Row lock serialises concurrent runs (cron + manual) for the same payment.
          await tx.$queryRaw`SELECT id FROM recurring_payments WHERE id = ${p.id} FOR UPDATE`;
          const exists = await tx.queueItem.findFirst({ where: { workspaceId, recurrenceId: p.id, pnlPeriod: period } });
          if (exists) {
            // Queued 7 days ahead; flag it urgent once the due date is within urgentDays (spec §5.2).
            if (daysToDue <= p.urgentDays && exists.status === 'PENDING' && !exists.isUrgent) {
              await tx.queueItem.update({ where: { id: exists.id }, data: { isUrgent: true } });
            }
            return null;
          }
          const qi = await tx.queueItem.create({ data: built.data });
          const nextDue = dueDateIn(due.getUTCFullYear(), due.getUTCMonth() + 1, p.dayOfMonth);
          await tx.recurringPayment.update({
            where: { id: p.id },
            data: { lastChargedAt: new Date(), nextRunDate: new Date(nextDue.getTime() - LEAD_DAYS * DAY_MS) },
          });
          return qi;
        });
        if (!item) continue;
        result.queued++;
        created.push({ id: item.id, vendorName: item.vendorName, total: Number(item.total), description: item.description });
      } catch (error) {
        errors.push({ recurringPaymentId: p.id, description, error: (error as Error).message });
      }
    }

    for (const item of created) {
      await this.audit.record(
        workspaceId,
        actor,
        AUDIT_ACTIONS.QUEUE_ITEM_ADDED,
        `${item.vendorName ?? 'Vendor'} · ₦${item.total.toLocaleString('en-NG')}`,
        { queueItemId: item.id, description: item.description, total: item.total, source: 'recurring' },
        { type: 'queue_item', id: item.id },
      );
      await this.notifier.notify(workspaceId, 'queue_added', {
        queueItemId: item.id,
        vendorName: item.vendorName,
        total: item.total,
        description: item.description,
        source: 'recurring',
      });
    }

    if (errors.length) result.errors = errors;
    return result;
  }

  /** Daily job: every workspace that has active recurring payments. */
  async runAll(): Promise<{ workspaces: number; queued: number; skippedNoBank: number; errors: number }> {
    const groups = await this.prisma.recurringPayment.groupBy({
      by: ['workspaceId'],
      where: { isActive: true, workspace: { status: { notIn: ['DEAD', 'SUSPENDED', 'PAUSED'] } } },
    });
    const totals = { workspaces: groups.length, queued: 0, skippedNoBank: 0, errors: 0 };
    for (const g of groups) {
      try {
        const r = await this.run(g.workspaceId, null);
        totals.queued += r.queued;
        totals.skippedNoBank += r.skippedNoBank;
        totals.errors += r.errors?.length ?? 0;
      } catch (error) {
        totals.errors++;
        this.logger.error(`Recurring run failed for workspace ${g.workspaceId}`, error as Error);
      }
    }
    return totals;
  }
}
