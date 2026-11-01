import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { runIdempotent } from '../../common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../platform/audit-log.service';
import { InvoiceConfigService } from './invoice-config.service';
import { InvoiceMonnifyClient } from './invoice-monnify.client';
import { InvoicePaymentsService } from './invoice-payments.service';
import { InvoiceSheetsSyncService } from './invoice-sheets-sync.service';
import { MonnifyHookEvent, registerMonnifyCollectionHook } from './collection-hook';
import { round2 } from './invoice-dates.util';

/**
 * Per-invoice collection accounts (spec §5.8): each issued invoice gets a dedicated Monnify
 * reserved account; transfers into it are detected from the Monnify collection webhook, applied
 * as payments, and (when `sweep_enabled`) the money minus a buffer is swept out to the
 * configured bank account.
 */
@Injectable()
export class InvoiceCollectionsService implements OnModuleInit {
  private readonly logger = new Logger(InvoiceCollectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly monnify: InvoiceMonnifyClient,
    private readonly payments: InvoicePaymentsService,
    private readonly config: InvoiceConfigService,
    private readonly audit: AuditLogService,
    private readonly sheets: InvoiceSheetsSyncService,
  ) {}

  onModuleInit() {
    registerMonnifyCollectionHook('invoice-collections', (event) => this.handleWebhookEvent(event));
  }

  /** Creates the invoice's reserved account if it doesn't have one yet. Never throws. */
  async ensureCollectionAccount(invoiceId: string): Promise<void> {
    try {
      const inv = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { customer: true, workspace: { select: { name: true } } },
      });
      if (!inv || inv.docType !== 'INVOICE' || inv.collectionAccountNumber || inv.status === 'VOID') return;
      const reference = `INV-${inv.id}`;
      const acct = await this.monnify.createReservedAccount({
        accountReference: reference,
        accountName: `${inv.workspace.name} ${inv.invoiceNumber ?? ''}`.trim(),
        customerEmail: inv.customer.email || `invoice-${inv.id.slice(0, 8)}@paidinfull.app`,
        customerName: inv.customer.name,
      });
      await this.prisma.invoice.update({
        where: { id: inv.id },
        data: {
          collectionAccountNumber: acct.accountNumber,
          collectionAccountName: acct.accountName,
          collectionBankName: acct.bankName,
          collectionAccountRef: acct.accountReference,
        },
      });
    } catch (err) {
      this.logger.warn(`Could not create collection account for invoice ${invoiceId}: ${(err as Error).message}`);
    }
  }

  /**
   * Monnify webhook hook. Claims:
   *  - SUCCESSFUL_TRANSACTION into an invoice's reserved account (by account reference or
   *    destination account number);
   *  - disbursement results for sweep references (SWP-…).
   */
  async handleWebhookEvent(event: MonnifyHookEvent): Promise<boolean> {
    const type = (event.eventType ?? '').toUpperCase();
    const d = event.data ?? {};

    if (type.includes('DISBURSEMENT')) {
      const ref: string | undefined = d.reference ?? d.transactionReference;
      if (!ref || !ref.startsWith('SWP-')) return false;
      const sweep = await this.prisma.invoiceSweep.findUnique({ where: { reference: ref } });
      if (!sweep) return false;
      const failed = type.includes('FAILED') || type.includes('REVERS') || String(d.status ?? '').toUpperCase() === 'FAILED';
      await this.prisma.invoiceSweep.update({ where: { id: sweep.id }, data: { status: failed ? 'FAILED' : 'SUCCESS' } });
      return true;
    }

    if (!type.includes('TRANSACTION') && !type.includes('COLLECTION')) return false;
    const accountReference: string | undefined = d.product?.reference ?? d.accountReference;
    const accountNumber: string | undefined =
      d.destinationAccountInformation?.accountNumber ?? d.accountDetails?.accountNumber ?? d.destinationAccountNumber;
    const reference: string | undefined = d.transactionReference ?? d.paymentReference;
    const amount = Number(d.amountPaid ?? d.amount ?? 0);
    if (!reference || !(amount > 0)) return false;
    if (!accountReference && !accountNumber) return false;

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        OR: [
          ...(accountReference ? [{ collectionAccountRef: accountReference }] : []),
          ...(accountNumber ? [{ collectionAccountNumber: accountNumber }] : []),
        ],
      },
      select: { id: true },
    });
    if (!invoice) return false;

    await this.handleCollection(invoice.id, amount, reference, d.paidOn ? new Date(d.paidOn) : undefined);
    return true;
  }

  /**
   * InvoiceCollectionsService.handleCollection: money arrived in an invoice's collection account.
   * Idempotent on the Monnify transaction reference.
   */
  async handleCollection(invoiceId: string, amount: number, reference: string, paidAt?: Date) {
    const existing = await this.prisma.invoicePayment.findFirst({ where: { invoiceId, monnifyReference: reference } });
    const existingCredit = await this.prisma.customerCredit.findFirst({
      where: { sourceInvoiceId: invoiceId, note: { contains: `(ref ${reference})` } },
    });
    if (existing || existingCredit) {
      this.logger.log(`Collection ${reference} for invoice ${invoiceId} already applied`);
      return { duplicate: true };
    }

    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('Invoice not found');

    // runIdempotent keys on the Monnify reference, so concurrent webhook deliveries can't double-apply.
    const result = await runIdempotent(this.prisma, inv.workspaceId, 'invoice.collection', reference, async (tx) => {
      if (inv.status !== 'VOID' && inv.status !== 'DRAFT') {
        const r = await this.payments.applyPaymentTx(tx, invoiceId, {
          amount,
          method: 'MONNIFY',
          reference,
          paidAt,
          notes: 'Auto-detected transfer to collection account',
        });
        return { applied: r.applied, excess: r.excess };
      }
      // Money landed on an invoice that can't take payments: keep it as customer credit.
      await tx.customerCredit.create({
        data: {
          workspaceId: inv.workspaceId,
          customerId: inv.customerId,
          amount: round2(amount),
          status: 'OPEN',
          sourceInvoiceId: inv.id,
          note: `Transfer to collection account of ${inv.status.toLowerCase()} invoice ${inv.invoiceNumber ?? ''} (ref ${reference})`,
        },
      });
      return { applied: 0, excess: round2(amount) };
    });
    this.sheets.sync(inv.workspaceId, inv.id);

    // Sweeps run after the payment commits; a sweep failure never undoes the payment.
    await this.sweep(inv.workspaceId, inv.id, amount, reference).catch((err) =>
      this.logger.error(`Sweep after collection ${reference} failed: ${(err as Error).message}`),
    );
    return { duplicate: false, ...result };
  }

  /** Sweeps `amount - buffer` out to the configured destination when sweep_enabled. */
  async sweep(workspaceId: string, invoiceId: string, amount: number, collectionRef: string) {
    const s = await this.config.getSweepSettings(workspaceId);
    if (!s.enabled) return null;
    if (!s.bankCode || !s.accountNumber) {
      this.logger.warn(`Sweep enabled for workspace ${workspaceId} but no destination configured`);
      return null;
    }
    const sweepAmount = round2(amount - s.buffer);
    if (sweepAmount <= 0) return null;

    // Deterministic per collection: the unique reference makes a re-delivered webhook unable to sweep twice.
    const reference = `SWP-${createHash('sha1').update(collectionRef).digest('hex').slice(0, 24)}`;
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { monnifyReservedAccountNumber: true },
    });
    let sweep;
    try {
      sweep = await this.prisma.invoiceSweep.create({
        data: { invoiceId, amount: sweepAmount, reference, status: 'PENDING', sheetRowReference: collectionRef },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
    try {
      // ASSUMPTION (unverified): collections settle into the merchant Monnify wallet, and the
      // workspace's wallet account is the transfer source. Confirm against the live contract.
      const res = await this.monnify.transfer({
        amount: sweepAmount,
        reference,
        narration: `Invoice collection sweep ${collectionRef}`,
        bankCode: s.bankCode,
        accountNumber: s.accountNumber,
        sourceAccountNumber: ws?.monnifyReservedAccountNumber,
      });
      const updated = await this.prisma.invoiceSweep.update({
        where: { id: sweep.id },
        data: { status: res.status === 'SUCCESS' ? 'SUCCESS' : res.status === 'FAILED' ? 'FAILED' : 'PENDING' },
      });
      await this.audit.record(workspaceId, null, 'invoice.swept', reference, {
        invoiceId,
        amount: sweepAmount,
        buffer: s.buffer,
        destination: `${s.bankCode}/${s.accountNumber}`,
        status: updated.status,
      });
      return updated;
    } catch (err) {
      await this.prisma.invoiceSweep.update({ where: { id: sweep.id }, data: { status: 'FAILED' } });
      throw err;
    }
  }

  /** Mock mode only: simulate a customer transfer into an invoice's collection account. */
  async simulate(workspaceId: string, invoiceId: string, amount: number) {
    if (!this.monnify.isMock) throw new BadRequestException('Only available in Monnify mock mode');
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, workspaceId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (!inv.collectionAccountNumber) await this.ensureCollectionAccount(inv.id);
    const fresh = await this.prisma.invoice.findUnique({ where: { id: inv.id } });
    if (!fresh?.collectionAccountNumber) throw new BadRequestException('Invoice has no collection account (issue it first)');
    const reference = `MNFY|MOCK|${Date.now()}`;
    const claimed = await this.handleWebhookEvent({
      eventType: 'SUCCESSFUL_TRANSACTION',
      data: {
        transactionReference: reference,
        paymentReference: reference,
        amountPaid: amount,
        paidOn: new Date().toISOString(),
        product: { type: 'RESERVED_ACCOUNT', reference: fresh.collectionAccountRef },
        destinationAccountInformation: { accountNumber: fresh.collectionAccountNumber },
      },
    });
    return { claimed, reference };
  }
}
