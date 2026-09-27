import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { paginate, PaginationDto } from '../../common';
import { CreateCustomerSubscriptionDto, UpdateCustomerSubscriptionDto } from './dto';
import { InvoiceStatus, RecurrenceInterval } from '@prisma/client';

function advance(date: Date, interval: RecurrenceInterval): Date {
  const d = new Date(date);
  switch (interval) {
    case RecurrenceInterval.WEEKLY:
      d.setDate(d.getDate() + 7);
      break;
    case RecurrenceInterval.MONTHLY:
      d.setMonth(d.getMonth() + 1);
      break;
    case RecurrenceInterval.QUARTERLY:
      d.setMonth(d.getMonth() + 3);
      break;
    case RecurrenceInterval.ANNUALLY:
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}

@Injectable()
export class CustomerSubscriptionsService {
  private readonly logger = new Logger(CustomerSubscriptionsService.name);

  constructor(private prisma: PrismaService) {}

  async findAll(workspaceId: string, pagination: PaginationDto) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const [data, total] = await Promise.all([
      this.prisma.customerSubscription.findMany({
        where: { workspaceId },
        include: { customer: true },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customerSubscription.count({ where: { workspaceId } }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(workspaceId: string, id: string) {
    const record = await this.prisma.customerSubscription.findFirst({
      where: { id, workspaceId },
      include: { customer: true },
    });
    if (!record) throw new NotFoundException('Customer subscription not found');
    return record;
  }

  async create(workspaceId: string, dto: CreateCustomerSubscriptionDto) {
    const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, workspaceId } });
    if (!customer) throw new NotFoundException('Customer not found in this workspace');

    return this.prisma.customerSubscription.create({
      data: {
        workspaceId,
        customerId: dto.customerId,
        interval: dto.interval,
        amount: dto.amount,
        nextRunAt: dto.nextRunAt ? new Date(dto.nextRunAt) : new Date(),
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(workspaceId: string, id: string, dto: UpdateCustomerSubscriptionDto) {
    await this.findOne(workspaceId, id);
    return this.prisma.customerSubscription.update({
      where: { id },
      data: {
        ...(dto.interval !== undefined ? { interval: dto.interval } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.nextRunAt !== undefined ? { nextRunAt: new Date(dto.nextRunAt) } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async remove(workspaceId: string, id: string) {
    await this.findOne(workspaceId, id);
    await this.prisma.customerSubscription.delete({ where: { id } });
    return { success: true };
  }

  // ─── Cron: generate invoices for subscriptions due today ────────────────────

  @Cron('0 8 * * *')
  async generateDueInvoices() {
    const now = new Date();
    const due = await this.prisma.customerSubscription.findMany({
      where: { isActive: true, nextRunAt: { lte: now } },
      include: { customer: true },
    });

    this.logger.log(`Generating invoices for ${due.length} due customer subscriptions`);

    for (const sub of due) {
      try {
        await this.generateInvoiceForSubscription(sub);
      } catch (error) {
        this.logger.error(`Failed to generate invoice for customer subscription ${sub.id}`, error as Error);
      }
    }
  }

  private async nextInvoiceNumber(workspaceId: string): Promise<string> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    const prefix = workspace?.invoicePrefix ?? 'INV';

    const last = await this.prisma.invoice.findFirst({
      where: { workspaceId, invoiceNumber: { startsWith: `${prefix}-` } },
      orderBy: { createdAt: 'desc' },
    });

    let nextSeq = 1;
    if (last?.invoiceNumber) {
      const match = last.invoiceNumber.match(/(\d+)$/);
      if (match) {
        nextSeq = parseInt(match[1], 10) + 1;
      }
    }
    return `${prefix}-${String(nextSeq).padStart(5, '0')}`;
  }

  private async generateInvoiceForSubscription(sub: {
    id: string;
    workspaceId: string;
    customerId: string;
    interval: RecurrenceInterval;
    amount: any;
    nextRunAt: Date;
    customer: { name: string };
  }) {
    const invoiceNumber = await this.nextInvoiceNumber(sub.workspaceId);
    const amount = Number(sub.amount);
    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 7);

    await this.prisma.$transaction([
      this.prisma.invoice.create({
        data: {
          workspaceId: sub.workspaceId,
          customerId: sub.customerId,
          invoiceNumber,
          status: InvoiceStatus.SENT,
          issueDate,
          dueDate,
          subtotal: amount,
          taxAmount: 0,
          total: amount,
          notes: `Auto-generated from recurring subscription (${sub.interval})`,
          items: {
            create: [
              {
                description: `${sub.interval[0]}${sub.interval.slice(1).toLowerCase()} subscription charge — ${sub.customer.name}`,
                quantity: 1,
                unitPrice: amount,
              },
            ],
          },
        },
      }),
      this.prisma.customerSubscription.update({
        where: { id: sub.id },
        data: { nextRunAt: advance(sub.nextRunAt, sub.interval) },
      }),
    ]);

    this.logger.log(`Generated invoice ${invoiceNumber} for customer subscription ${sub.id}`);
  }
}
