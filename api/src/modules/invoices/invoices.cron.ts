import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../platform/audit-log.service';
import { addDays, round2 } from './invoice-dates.util';
import { deriveInvoiceStatus } from './invoice-payments.service';
import { InvoiceRecurrencesService } from './invoice-recurrences.service';
import { InvoiceSheetsSyncService } from './invoice-sheets-sync.service';

/**
 * Daily invoicing job (06:00 server time):
 *  1. recurring schedules → draft invoices for review;
 *  2. issued invoices past their due date → OVERDUE;
 *  3. late fees applied once the grace period after the due date has passed.
 */
@Injectable()
export class InvoicesCron {
  private readonly logger = new Logger(InvoicesCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recurrences: InvoiceRecurrencesService,
    private readonly audit: AuditLogService,
    private readonly sheets: InvoiceSheetsSyncService,
  ) {}

  @Cron('0 6 * * *')
  async handleDailyRun() {
    this.logger.log('Running daily invoice job (recurring drafts, overdue, late fees)…');
    const recurring = await this.recurrences.runAllDue().catch((err) => {
      this.logger.error(`Recurring drafts failed: ${err.message}`);
      return { generated: 0 };
    });
    const overdue = await this.markOverdueInvoices();
    const lateFees = await this.applyLateFees();
    this.logger.log(`Daily invoice job done: ${recurring.generated} draft(s), ${overdue.count} overdue, ${lateFees.applied} late fee(s)`);
    return { recurring, overdue: overdue.count, lateFees: lateFees.applied };
  }

  async markOverdueInvoices() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows = await this.prisma.invoice.findMany({
      where: { docType: 'INVOICE', status: { in: ['SENT', 'PARTIALLY_PAID'] }, dueDate: { lt: today } },
      select: { id: true, workspaceId: true },
    });
    if (rows.length) {
      await this.prisma.invoice.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'OVERDUE' } });
      for (const r of rows) this.sheets.sync(r.workspaceId, r.id);
      this.logger.log(`Marked ${rows.length} invoice(s) overdue`);
    }
    return { count: rows.length };
  }

  /** Late fee = flat + percent of the outstanding balance, applied once after due date + grace days. */
  async applyLateFees() {
    const now = new Date();
    const candidates = await this.prisma.invoice.findMany({
      where: {
        docType: 'INVOICE',
        status: 'OVERDUE',
        lateFeeAppliedAt: null,
        OR: [{ lateFeePercent: { gt: 0 } }, { lateFeeFlat: { gt: 0 } }],
      },
    });
    let applied = 0;
    for (const inv of candidates) {
      if (!inv.dueDate) continue;
      const graceEnd = addDays(inv.dueDate, inv.lateFeeGraceDays ?? 0);
      graceEnd.setHours(23, 59, 59, 999);
      if (now <= graceEnd) continue;
      const balance = Number(inv.amountDue) - Number(inv.paidAmount);
      if (balance <= 0) continue;
      const fee = round2(Number(inv.lateFeeFlat ?? 0) + balance * (Number(inv.lateFeePercent ?? 0) / 100));
      if (fee <= 0) continue;
      const amountDue = round2(Number(inv.amountDue) + fee);
      // Guard on lateFeeAppliedAt: null so a concurrent run can't apply twice.
      const res = await this.prisma.invoice.updateMany({
        where: { id: inv.id, lateFeeAppliedAt: null },
        data: {
          lateFeeAmount: fee,
          lateFeeAppliedAt: now,
          amountDue,
          status: deriveInvoiceStatus({ ...inv, amountDue, paidAmount: Number(inv.paidAmount) }),
        },
      });
      if (res.count) {
        applied++;
        await this.audit.record(inv.workspaceId, null, 'invoice.late_fee_applied', inv.invoiceNumber, { invoiceId: inv.id, fee });
        this.sheets.sync(inv.workspaceId, inv.id);
      }
    }
    return { applied };
  }
}
