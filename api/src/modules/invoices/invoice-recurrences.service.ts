import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InvoiceRecurrence, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserData } from '../../common';
import { CreateInvoiceRecurrenceDto, InvoiceItemDto, UpdateInvoiceRecurrenceDto } from './dto';
import { advanceByInterval } from './invoice-dates.util';
import { InvoicesService } from './invoices.service';

type Actor = Pick<CurrentUserData, 'id' | 'email' | 'workspaceId'>;

/**
 * Recurring invoices (spec §4 invoice_recurrences, §5.8 Recurring): a cadence + template lines.
 * Runs generate DRAFT invoices for review and sending ("Generate drafts for review").
 */
@Injectable()
export class InvoiceRecurrencesService {
  private readonly logger = new Logger(InvoiceRecurrencesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
  ) {}

  findAll(workspaceId: string) {
    return this.prisma.invoiceRecurrence.findMany({
      where: { workspaceId },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        invoices: { select: { id: true, invoiceNumber: true, status: true, issueDate: true }, orderBy: { createdAt: 'desc' }, take: 5 },
      },
      orderBy: [{ isActive: 'desc' }, { nextRunAt: 'asc' }],
    });
  }

  async findOne(workspaceId: string, id: string) {
    const r = await this.prisma.invoiceRecurrence.findFirst({
      where: { id, workspaceId },
      include: { customer: true, invoices: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!r) throw new NotFoundException('Recurring invoice not found');
    return r;
  }

  async create(workspaceId: string, dto: CreateInvoiceRecurrenceDto) {
    const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, workspaceId } });
    if (!customer) throw new NotFoundException('Customer not found');
    return this.prisma.invoiceRecurrence.create({
      data: {
        workspaceId,
        customerId: dto.customerId,
        interval: dto.interval,
        nextRunAt: dto.nextRunAt,
        endsAt: dto.endsAt ?? null,
        dueDays: dto.dueDays ?? 14,
        currency: (dto.currency ?? 'NGN').toUpperCase(),
        notes: dto.notes ?? null,
        terms: dto.terms ?? null,
        templateItems: dto.items as unknown as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(workspaceId: string, id: string, dto: UpdateInvoiceRecurrenceDto) {
    await this.findOne(workspaceId, id);
    if (dto.customerId) {
      const c = await this.prisma.customer.findFirst({ where: { id: dto.customerId, workspaceId } });
      if (!c) throw new NotFoundException('Customer not found');
    }
    return this.prisma.invoiceRecurrence.update({
      where: { id },
      data: {
        ...(dto.customerId && { customerId: dto.customerId }),
        ...(dto.interval && { interval: dto.interval }),
        ...(dto.nextRunAt && { nextRunAt: dto.nextRunAt }),
        ...(dto.endsAt !== undefined && { endsAt: dto.endsAt }),
        ...(dto.dueDays !== undefined && { dueDays: dto.dueDays }),
        ...(dto.currency && { currency: dto.currency.toUpperCase() }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.terms !== undefined && { terms: dto.terms }),
        ...(dto.items && { templateItems: dto.items as unknown as Prisma.InputJsonValue }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(workspaceId: string, id: string) {
    await this.findOne(workspaceId, id);
    await this.prisma.invoiceRecurrence.delete({ where: { id } });
    return { message: 'Recurring invoice deleted' };
  }

  /** Manual "Generate drafts for review": all due schedules in the workspace. */
  async runDueForWorkspace(user: Actor) {
    const due = await this.prisma.invoiceRecurrence.findMany({
      where: { workspaceId: user.workspaceId, isActive: true, nextRunAt: { lte: endOfToday() } },
    });
    const results = [];
    for (const r of due) results.push(await this.generate(r, user));
    return { generated: results.filter((r) => r.invoiceId).length, results };
  }

  /** Generate now for one schedule, regardless of its next run date. */
  async runOne(user: Actor, id: string) {
    const r = await this.findOne(user.workspaceId, id);
    return this.generate(r, user, true);
  }

  /** Daily job across every workspace. */
  async runAllDue() {
    const due = await this.prisma.invoiceRecurrence.findMany({ where: { isActive: true, nextRunAt: { lte: endOfToday() } } });
    let generated = 0;
    for (const r of due) {
      const res = await this.generate(r, null);
      if (res.invoiceId) generated++;
    }
    return { generated };
  }

  private async generate(r: InvoiceRecurrence, user: Actor | null, force = false) {
    const now = new Date();
    if (r.endsAt && r.endsAt < now && !force) {
      await this.prisma.invoiceRecurrence.update({ where: { id: r.id }, data: { isActive: false } });
      return { recurrenceId: r.id, invoiceId: null, skipped: 'ended' };
    }
    if (!r.customerId) return { recurrenceId: r.id, invoiceId: null, skipped: 'no customer' };

    let items = (Array.isArray(r.templateItems) ? r.templateItems : []) as unknown as InvoiceItemDto[];
    if (!items.length && r.invoiceId) {
      const src = await this.prisma.invoiceItem.findMany({ where: { invoiceId: r.invoiceId }, orderBy: { sortOrder: 'asc' } });
      items = src.map((it) => ({
        productId: it.productId ?? undefined,
        description: it.description,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        vatRate: Number(it.vatRate),
        whtRate: Number(it.whtRate),
      }));
    }
    if (!items.length) return { recurrenceId: r.id, invoiceId: null, skipped: 'no lines' };

    // Inherit editor settings (discount, late fee…) from the source invoice when there is one.
    const src = r.invoiceId ? await this.prisma.invoice.findUnique({ where: { id: r.invoiceId } }) : null;
    try {
      const actor: Actor = user ?? { id: src?.createdById ?? '', email: '', workspaceId: r.workspaceId };
      const draft = await this.invoices.create(actor, {
          customerId: r.customerId,
          issueDate: now,
          dueDays: r.dueDays,
          currency: r.currency,
          notes: r.notes ?? undefined,
          terms: r.terms ?? undefined,
          ...(src && {
            taxInclusive: src.taxInclusive,
            discountType: src.discountType,
            discountValue: Number(src.discountValue),
            lateFeePercent: src.lateFeePercent == null ? undefined : Number(src.lateFeePercent),
            lateFeeFlat: src.lateFeeFlat == null ? undefined : Number(src.lateFeeFlat),
            lateFeeGraceDays: src.lateFeeGraceDays ?? undefined,
            earlyPayDiscountPercent: src.earlyPayDiscountPercent == null ? undefined : Number(src.earlyPayDiscountPercent),
            earlyPayDiscountDays: src.earlyPayDiscountDays ?? undefined,
          }),
          items: items.map((i) => ({
            productId: i.productId || undefined,
            description: i.description,
            quantity: Number(i.quantity) || 1,
            unitPrice: i.unitPrice == null ? undefined : Number(i.unitPrice),
            vatRate: i.vatRate == null ? undefined : Number(i.vatRate),
            whtRate: i.whtRate == null ? undefined : Number(i.whtRate),
          })),
      });
      await this.prisma.invoice.update({ where: { id: draft.id }, data: { recurrenceId: r.id } });

      // Advance past today (catch-up without generating a backlog of drafts).
      let next = r.nextRunAt;
      do next = advanceByInterval(next, r.interval);
      while (next <= now);
      const ended = !!r.endsAt && next > r.endsAt;
      await this.prisma.invoiceRecurrence.update({
        where: { id: r.id },
        data: { nextRunAt: next, lastRunAt: now, ...(ended && { isActive: false }) },
      });
      this.logger.log(`Recurring ${r.id}: generated draft ${draft.invoiceNumber}`);
      return { recurrenceId: r.id, invoiceId: draft.id, invoiceNumber: draft.invoiceNumber };
    } catch (err) {
      this.logger.error(`Recurring ${r.id} failed: ${(err as Error).message}`);
      return { recurrenceId: r.id, invoiceId: null, error: (err as Error).message };
    }
  }
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
