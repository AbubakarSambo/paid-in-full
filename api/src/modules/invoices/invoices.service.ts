import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../../common';
import {
  CreateInvoiceDto,
  UpdateInvoiceDto,
  InvoiceFilterDto,
  RecordPaymentDto,
  SendInvoiceDto,
  CreateRecurrenceDto,
  CreateSweepDto,
  FromTemplateDto,
} from './dto';
import { addDays, advanceByInterval, round2 } from './invoice-dates.util';

const DEFAULT_PAYMENT_TERMS_DAYS = 14;

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService) {}

  async findAll(workspaceId: string, filter: InvoiceFilterDto) {
    const { page = 1, limit = 20, status, customerId, startDate, endDate } = filter;
    const skip = (page - 1) * limit;

    const where: Prisma.InvoiceWhereInput = {
      workspaceId,
      ...(status && { status }),
      ...(customerId && { customerId }),
      ...((startDate || endDate) && {
        issueDate: {
          ...(startDate && { gte: startDate }),
          ...(endDate && { lte: endDate }),
        },
      }),
    };

    const [invoices, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { issueDate: 'desc' },
        include: { customer: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return paginate(invoices, total, page, limit);
  }

  async findOne(id: string, workspaceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, workspaceId },
      include: {
        customer: true,
        items: true,
        payments: { orderBy: { paidAt: 'desc' } },
        sends: { orderBy: { sentAt: 'desc' } },
        recurrence: true,
        sweeps: { orderBy: { matchedAt: 'desc' } },
        receipts: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async create(workspaceId: string, dto: CreateInvoiceDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, workspaceId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { invoicePrefix: true, taxRate: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const invoiceNumber = await this.generateInvoiceNumber(workspaceId, workspace.invoicePrefix);
    const { subtotal, taxAmount, total } = this.calculateTotals(dto.items, Number(workspace.taxRate));
    const dueDate = dto.dueDate ?? addDays(dto.issueDate, DEFAULT_PAYMENT_TERMS_DAYS);

    return this.prisma.invoice.create({
      data: {
        workspaceId,
        customerId: dto.customerId,
        invoiceNumber,
        issueDate: dto.issueDate,
        dueDate,
        subtotal,
        taxAmount,
        total,
        customerAddress: dto.customerAddress ?? customer.address ?? null,
        notes: dto.notes,
        items: {
          create: dto.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
      },
      include: { items: true, customer: true },
    });
  }

  async update(id: string, workspaceId: string, dto: UpdateInvoiceDto) {
    const invoice = await this.findRaw(id, workspaceId);
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException('Only draft invoices can be edited');
    }

    let totals: { subtotal: number; taxAmount: number; total: number } | undefined;
    if (dto.items) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { taxRate: true },
      });
      totals = this.calculateTotals(dto.items, Number(workspace!.taxRate));
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
        await tx.invoiceItem.createMany({
          data: dto.items.map((item) => ({
            invoiceId: id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        });
      }

      return tx.invoice.update({
        where: { id },
        data: {
          ...(dto.issueDate && { issueDate: dto.issueDate }),
          ...(dto.dueDate && { dueDate: dto.dueDate }),
          ...(dto.customerAddress !== undefined && { customerAddress: dto.customerAddress }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(totals && {
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            total: totals.total,
          }),
        },
        include: { items: true, customer: true },
      });
    });
  }

  async remove(id: string, workspaceId: string) {
    const invoice = await this.findRaw(id, workspaceId);
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException('Only draft invoices can be deleted');
    }
    await this.prisma.invoice.delete({ where: { id } });
    return { message: 'Invoice deleted successfully' };
  }

  async recordPayment(id: string, workspaceId: string, dto: RecordPaymentDto) {
    const invoice = await this.findRaw(id, workspaceId);
    if (invoice.status === 'VOID') {
      throw new BadRequestException('Cannot record a payment against a voided invoice');
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.invoicePayment.create({
        data: {
          invoiceId: id,
          amount: dto.amount,
          monnifyReference: dto.monnifyReference,
        },
      });

      const amountPaid = round2(Number(invoice.amountPaid) + dto.amount);
      const total = Number(invoice.total);
      const status = amountPaid >= total ? 'PAID' : amountPaid > 0 ? 'PARTIALLY_PAID' : invoice.status;

      const updatedInvoice = await tx.invoice.update({
        where: { id },
        data: { amountPaid, status },
      });

      const paymentSequence = (await tx.paymentReceipt.count({ where: { invoiceId: id } })) + 1;
      const receipt = await tx.paymentReceipt.create({
        data: {
          invoiceId: id,
          invoicePaymentId: payment.id,
          receiptNumber: `${invoice.invoiceNumber}-R${paymentSequence.toString().padStart(2, '0')}`,
        },
      });

      return { payment, receipt, invoice: updatedInvoice };
    });
  }

  async send(id: string, workspaceId: string, dto: SendInvoiceDto) {
    const invoice = await this.findRaw(id, workspaceId);
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException('Only draft invoices can be sent');
    }

    // TODO: inject EmailService (and equivalent WhatsApp/SMS senders) once the email module
    // exists, and actually dispatch the invoice to dto.recipient over dto.channel here.
    const send = await this.prisma.invoiceSend.create({
      data: { invoiceId: id, channel: dto.channel, sentTo: dto.recipient },
    });

    await this.prisma.invoice.update({ where: { id }, data: { status: 'SENT' } });

    return send;
  }

  async createRecurrence(id: string, workspaceId: string, dto: CreateRecurrenceDto) {
    const invoice = await this.findRaw(id, workspaceId);

    const existing = await this.prisma.invoiceRecurrence.findUnique({ where: { invoiceId: id } });
    if (existing) {
      throw new ConflictException('This invoice already has a recurrence configured');
    }

    const nextRunAt = advanceByInterval(invoice.issueDate, dto.interval);

    return this.prisma.invoiceRecurrence.create({
      data: {
        invoiceId: id,
        interval: dto.interval,
        nextRunAt,
        endsAt: dto.endsAt,
      },
    });
  }

  async createSweep(id: string, workspaceId: string, dto: CreateSweepDto) {
    const invoice = await this.findRaw(id, workspaceId);
    if (invoice.status === 'VOID') {
      throw new BadRequestException('Cannot apply a sweep to a voided invoice');
    }

    return this.prisma.$transaction(async (tx) => {
      const sweep = await tx.invoiceSweep.create({
        data: {
          invoiceId: id,
          sheetRowReference: dto.sheetRowReference,
          amount: dto.amount,
        },
      });

      const amountPaid = round2(Number(invoice.amountPaid) + dto.amount);
      const total = Number(invoice.total);
      const status = amountPaid >= total ? 'PAID' : amountPaid > 0 ? 'PARTIALLY_PAID' : invoice.status;

      await tx.invoice.update({ where: { id }, data: { amountPaid, status } });

      return sweep;
    });
  }

  async fromTemplate(templateId: string, workspaceId: string, dto: FromTemplateDto) {
    const template = await this.prisma.invoiceTemplate.findFirst({
      where: { id: templateId, workspaceId },
      include: { items: true },
    });
    if (!template) throw new NotFoundException('Invoice template not found');

    return this.create(workspaceId, {
      customerId: dto.customerId,
      issueDate: dto.issueDate,
      notes: template.notes ?? undefined,
      items: template.items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
      })),
    });
  }

  async findReceipt(invoiceId: string, receiptId: string, workspaceId: string) {
    const receipt = await this.prisma.paymentReceipt.findFirst({
      where: { id: receiptId, invoiceId, invoice: { workspaceId } },
      include: { invoice: { include: { customer: true } }, invoicePayment: true },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    return receipt;
  }

  async findRaw(id: string, workspaceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id, workspaceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  private calculateTotals(
    items: { quantity: number; unitPrice: number }[],
    taxRate: number,
  ): { subtotal: number; taxAmount: number; total: number } {
    const subtotal = round2(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
    const taxAmount = round2(subtotal * (taxRate / 100));
    const total = round2(subtotal + taxAmount);
    return { subtotal, taxAmount, total };
  }

  private async generateInvoiceNumber(workspaceId: string, prefix: string): Promise<string> {
    const existing = await this.prisma.invoice.findMany({
      where: { workspaceId, invoiceNumber: { startsWith: prefix } },
      select: { invoiceNumber: true },
    });

    let maxSequence = 0;
    for (const inv of existing) {
      const suffix = inv.invoiceNumber.slice(prefix.length);
      const parsed = parseInt(suffix, 10);
      if (!isNaN(parsed) && parsed > maxSequence) {
        maxSequence = parsed;
      }
    }

    return `${prefix}${(maxSequence + 1).toString().padStart(5, '0')}`;
  }
}
