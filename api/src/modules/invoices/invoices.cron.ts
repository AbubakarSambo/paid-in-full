import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, advanceByInterval } from './invoice-dates.util';

const DEFAULT_PAYMENT_TERMS_DAYS = 14;

@Injectable()
export class InvoicesCron {
  private readonly logger = new Logger(InvoicesCron.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 6 * * *')
  async handleDailyRun() {
    this.logger.log('Running daily invoice recurrence + overdue check...');
    await this.generateRecurringInvoices();
    await this.markOverdueInvoices();
    this.logger.log('Daily invoice recurrence + overdue check complete.');
  }

  async generateRecurringInvoices() {
    const now = new Date();
    const dueRecurrences = await this.prisma.invoiceRecurrence.findMany({
      where: { isActive: true, nextRunAt: { lte: now } },
      include: { invoice: { include: { items: true } } },
    });

    for (const recurrence of dueRecurrences) {
      if (recurrence.endsAt && recurrence.endsAt <= now) {
        await this.prisma.invoiceRecurrence.update({
          where: { id: recurrence.id },
          data: { isActive: false },
        });
        continue;
      }

      const source = recurrence.invoice;
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: source.workspaceId },
        select: { invoicePrefix: true },
      });
      const invoiceNumber = await this.generateInvoiceNumber(
        source.workspaceId,
        workspace!.invoicePrefix,
      );

      const issueDate = new Date();
      const dueDate = addDays(issueDate, DEFAULT_PAYMENT_TERMS_DAYS);

      await this.prisma.invoice.create({
        data: {
          workspaceId: source.workspaceId,
          customerId: source.customerId,
          invoiceNumber,
          issueDate,
          dueDate,
          subtotal: source.subtotal,
          taxAmount: source.taxAmount,
          total: source.total,
          customerAddress: source.customerAddress,
          notes: source.notes,
          items: {
            create: source.items.map((item) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
            })),
          },
        },
      });

      await this.prisma.invoiceRecurrence.update({
        where: { id: recurrence.id },
        data: { nextRunAt: advanceByInterval(recurrence.nextRunAt, recurrence.interval) },
      });

      this.logger.log(`Generated recurring invoice ${invoiceNumber} from ${source.invoiceNumber}`);
    }
  }

  async markOverdueInvoices() {
    const result = await this.prisma.invoice.updateMany({
      where: {
        status: { in: ['SENT', 'PARTIALLY_PAID'] },
        dueDate: { lt: new Date() },
      },
      data: { status: 'OVERDUE' },
    });

    if (result.count > 0) {
      this.logger.log(`Marked ${result.count} invoice(s) as overdue`);
    }

    return result;
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
