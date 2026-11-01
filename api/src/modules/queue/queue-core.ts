import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CostCenter, Location, PayCategory, CoaTag, Prisma, Vendor } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhtService, computeWht } from '../wht/wht.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Shared queue-line building blocks used by the queue, requisitions (push to queue) and recurring
 * payments. Everything that creates a QueueItem should go through QueueLineBuilder.build() so the
 * spec §15 validation (vendor, description, category, COA ∈ category, unit amount > 0, BU/head
 * when required) and the spec §6 WHT maths are applied identically everywhere.
 */

export type DbClient = Prisma.TransactionClient | PrismaService;

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function toNum(val: Prisma.Decimal | number | string | null | undefined): number {
  if (val === null || val === undefined) return 0;
  return typeof val === 'number' ? val : Number(val);
}

export function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

export function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Parses YYYY-MM-DD / ISO / Date into a UTC-midnight Date (Prisma @db.Date). */
export function toDateOnly(value: string | Date | null | undefined): Date {
  if (!value) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const s = String(value).trim();
  // DD/MM/YYYY (CSV-friendly)
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) {
    const d = new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date "${s}"`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Reads a workspace AppConfig flag (JSON true / "true" / 1). */
export async function readConfigFlag(
  client: DbClient,
  workspaceId: string,
  key: string,
  defaultValue = false,
): Promise<boolean> {
  const row = await client.appConfig.findUnique({ where: { workspaceId_key: { workspaceId, key } } });
  if (!row) return defaultValue;
  const v = row.value as unknown;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['true', '1', 'yes', 'on'].includes(v.toLowerCase());
  return defaultValue;
}

export function vendorHasBankDetails(v: Pick<Vendor, 'bankAccountNumber' | 'bankCode' | 'bankName'>): boolean {
  return !!v.bankAccountNumber && /^\d{10}$/.test(v.bankAccountNumber) && !!(v.bankCode || v.bankName);
}

export interface QueueActor {
  id: string;
  displayName?: string | null;
}

export interface QueueLineInput {
  date?: string | Date | null;
  vendorId: string;
  description: string;
  payCategoryId: string;
  coaTagId: string;
  costCenterId?: string | null;
  locationId?: string | null;
  units?: number | null;
  unitName?: string | null;
  unitAmount: number;
  pnlPeriod?: string | null;
  isUrgent?: boolean;
  /** Manual WHT rate (fraction 0–1). When set, overrides the §6 resolution. */
  whtRateOverride?: number | null;
  bundleId?: string | null;
  bundleLabel?: string | null;
  recurrenceId?: string | null;
  requisitionId?: string | null;
  sourceInvoiceId?: string | null;
  attachmentGroupId?: string | null;
  requestedByName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | Date | null;
}

/** Lookup tables loaded once per request so bulk operations don't hit the DB per row. */
export interface QueueLineContext {
  businessUnitsRequired: boolean;
  vendors: Map<string, Vendor>;
  categories: Map<string, PayCategory>;
  coaTags: Map<string, CoaTag>;
  costCenters: Map<string, CostCenter>;
  locations: Map<string, Location>;
}

export interface BuiltQueueLine {
  data: Prisma.QueueItemUncheckedCreateInput;
  vendor: Vendor;
  whtLabel: string;
}

@Injectable()
export class QueueLineBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wht: WhtService,
  ) {}

  async loadContext(client: DbClient, workspaceId: string): Promise<QueueLineContext> {
    const [businessUnitsRequired, vendors, categories, coaTags, costCenters, locations] = await Promise.all([
      readConfigFlag(client, workspaceId, 'business_units_required', false),
      client.vendor.findMany({ where: { workspaceId } }),
      client.payCategory.findMany({ where: { workspaceId } }),
      client.coaTag.findMany({ where: { workspaceId } }),
      client.costCenter.findMany({ where: { workspaceId } }),
      client.location.findMany({ where: { workspaceId } }),
    ]);
    return {
      businessUnitsRequired,
      vendors: new Map(vendors.map((v) => [v.id, v])),
      categories: new Map(categories.map((c) => [c.id, c])),
      coaTags: new Map(coaTags.map((c) => [c.id, c])),
      costCenters: new Map(costCenters.map((c) => [c.id, c])),
      locations: new Map(locations.map((l) => [l.id, l])),
    };
  }

  /**
   * Validates one line (throws BadRequestException with a human message) and returns the
   * QueueItem create payload with units × unitAmount = total and WHT/net per spec §6.
   */
  async build(
    workspaceId: string,
    actor: QueueActor,
    input: QueueLineInput,
    ctx: QueueLineContext,
  ): Promise<BuiltQueueLine> {
    const vendor = input.vendorId ? ctx.vendors.get(input.vendorId) : undefined;
    if (!vendor) throw new BadRequestException('Vendor is required and must come from the Vendor Register');
    if (!vendor.isActive) throw new BadRequestException(`Vendor "${vendor.name}" is inactive`);
    if (!vendorHasBankDetails(vendor)) {
      throw new BadRequestException(`Vendor "${vendor.name}" has no bank details — add them in the Vendor Register first`);
    }

    const description = (input.description ?? '').trim();
    if (!description) throw new BadRequestException('Description is required');

    const category = input.payCategoryId ? ctx.categories.get(input.payCategoryId) : undefined;
    if (!category) throw new BadRequestException('Payment category is required');

    const coa = input.coaTagId ? ctx.coaTags.get(input.coaTagId) : undefined;
    if (!coa) throw new BadRequestException('COA tag is required');
    // TODO(coa-tags): replace with the shared assertCoaBelongsToCategory helper once it lands.
    if (coa.payCategoryId !== category.id) {
      throw new BadRequestException(`COA "${coa.name}" does not belong to category "${category.name}"`);
    }

    const costCenterId = input.costCenterId || null;
    const locationId = input.locationId || null;
    if (costCenterId && !ctx.costCenters.has(costCenterId)) throw new BadRequestException('Business Unit not found');
    if (locationId) {
      const loc = ctx.locations.get(locationId);
      if (!loc) throw new BadRequestException('BU Head not found');
      if (costCenterId && loc.costCenterId && loc.costCenterId !== costCenterId) {
        throw new BadRequestException('BU Head does not belong to the selected Business Unit');
      }
    }
    if (ctx.businessUnitsRequired) {
      if (!costCenterId) throw new BadRequestException('Business Unit is required');
      if (!locationId) throw new BadRequestException('BU Head is required');
    }

    const units = input.units === null || input.units === undefined ? 1 : Number(input.units);
    if (!Number.isFinite(units) || units <= 0) throw new BadRequestException('Units must be greater than 0');
    const unitAmount = Number(input.unitAmount);
    if (!Number.isFinite(unitAmount) || unitAmount <= 0) throw new BadRequestException('Unit amount must be greater than 0');
    const total = round2(units * unitAmount);

    const date = toDateOnly(input.date ?? null);
    const pnlPeriod = input.pnlPeriod ? String(input.pnlPeriod).trim() : monthOf(date);
    if (!PERIOD_PATTERN.test(pnlPeriod)) throw new BadRequestException('P&L period must be YYYY-MM');

    let rate: number;
    let whtLabel: string;
    let whtOverride = false;
    if (input.whtRateOverride !== null && input.whtRateOverride !== undefined) {
      rate = Number(input.whtRateOverride);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new BadRequestException('WHT rate must be between 0 and 1');
      whtOverride = true;
      whtLabel = rate > 0 ? `Manual override · ${round2(rate * 100)}%` : 'No WHT applied (manual)';
    } else {
      const res = await this.wht.resolveRate(workspaceId, { vendor, coa: coa.name });
      rate = res.rate;
      whtLabel = res.label;
    }
    const { wht, net } = computeWht(total, rate);

    const data: Prisma.QueueItemUncheckedCreateInput = {
      workspaceId,
      date,
      vendorId: vendor.id,
      vendorName: vendor.name,
      description,
      units,
      unitName: input.unitName || null,
      unitAmount,
      total,
      whtRate: rate,
      whtAmount: wht,
      netAmount: net,
      whtOverride,
      whtSource: whtLabel,
      payCategoryId: category.id,
      payCategoryName: category.name,
      coaTagId: coa.id,
      coaTag: coa.name,
      costCenterId,
      locationId,
      pnlPeriod,
      isUrgent: !!input.isUrgent,
      bundleId: input.bundleId || null,
      bundleLabel: input.bundleLabel || null,
      recurrenceId: input.recurrenceId || null,
      requisitionId: input.requisitionId || null,
      sourceInvoiceId: input.sourceInvoiceId || null,
      attachmentGroupId: input.attachmentGroupId || null,
      requestedByName: input.requestedByName || null,
      invoiceNumber: input.invoiceNumber || null,
      invoiceDate: input.invoiceDate ? toDateOnly(input.invoiceDate) : null,
      status: 'PENDING',
      createdById: actor.id,
      createdByName: actor.displayName || null,
    };
    return { data, vendor, whtLabel };
  }

  /**
   * Spec §5.2 duplicate guard: same vendor + same rounded total in the queue (pending) or in
   * batches (not cancelled) within the last 7 days.
   */
  async findDuplicates(
    client: DbClient,
    workspaceId: string,
    vendorId: string,
    total: number,
    excludeQueueItemIds: string[] = [],
  ) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rounded = Math.round(total);
    const range = { gte: rounded - 0.5, lt: rounded + 0.5 };
    const [queue, batch] = await Promise.all([
      client.queueItem.findMany({
        where: {
          workspaceId,
          vendorId,
          status: { in: ['PENDING', 'APPROVED'] },
          total: range,
          createdAt: { gte: since },
          ...(excludeQueueItemIds.length && { id: { notIn: excludeQueueItemIds } }),
        },
        select: { id: true, description: true, total: true, date: true, status: true, createdAt: true },
        take: 5,
      }),
      client.batchItem.findMany({
        where: {
          batch: { workspaceId, payoutStatus: { not: 'CANCELLED' } },
          vendorId,
          total: range,
          createdAt: { gte: since },
          payoutStatus: { not: 'CANCELLED' },
          ...(excludeQueueItemIds.length && { OR: [{ queueItemId: null }, { queueItemId: { notIn: excludeQueueItemIds } }] }),
        },
        select: { id: true, description: true, total: true, date: true, queueItemId: true, batch: { select: { batchRef: true } } },
        take: 5,
      }),
    ]);
    // An approved queue item also appears as a batch line; report it once.
    const batchQueueIds = new Set(batch.map((b) => b.queueItemId).filter(Boolean));
    return [
      ...queue
        .filter((q) => !batchQueueIds.has(q.id))
        .map((q) => ({ source: 'queue' as const, id: q.id, description: q.description, total: toNum(q.total), date: q.date })),
      ...batch.map((b) => ({
        source: 'batch' as const,
        id: b.id,
        description: b.description,
        total: toNum(b.total),
        date: b.date,
        batchRef: b.batch.batchRef,
      })),
    ];
  }
}

/**
 * Bridges to NotificationsService.notify (being built by the notifications agent). Optional: if
 * the service or its notify() method doesn't exist yet, this is a logged no-op.
 * TODO(notifications): drop the duck-typing once NotificationsService.notify is final.
 */
@Injectable()
export class NotifyBridge {
  private readonly logger = new Logger(NotifyBridge.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  async notify(workspaceId: string, event: string, payload: Record<string, unknown>): Promise<void> {
    try {
      const svc = this.moduleRef.get(NotificationsService, { strict: false }) as unknown as {
        notify?: (workspaceId: string, event: string, payload: Record<string, unknown>) => Promise<unknown>;
      };
      if (svc && typeof svc.notify === 'function') {
        await svc.notify(workspaceId, event, payload);
      }
    } catch (error) {
      this.logger.warn(`notify(${event}) failed: ${(error as Error).message}`);
    }
  }
}
