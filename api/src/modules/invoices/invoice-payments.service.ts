import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Invoice, InvoiceStatus, Prisma } from '@prisma/client';
import { AUDIT_ACTIONS } from '../../common';
import { AuditLogService } from '../platform/audit-log.service';
import { addDays, round2 } from './invoice-dates.util';

type Tx = Prisma.TransactionClient;

/** Status an issued invoice should be in given its money position and due date. */
export function deriveInvoiceStatus(
  inv: Pick<Invoice, 'status' | 'docType' | 'dueDate'> & { amountDue: number; paidAmount: number },
  now = new Date(),
): InvoiceStatus {
  if (inv.status === 'VOID' || inv.status === 'DRAFT' || inv.docType === 'QUOTE') return inv.status;
  if (inv.paidAmount > 0 && inv.paidAmount + 0.005 >= inv.amountDue) return 'PAID';
  if (inv.amountDue <= 0) return 'PAID';
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (inv.dueDate && inv.dueDate < today) return 'OVERDUE';
  return inv.paidAmount > 0 ? 'PARTIALLY_PAID' : 'SENT';
}

export interface ApplyPaymentInput {
  amount: number;
  method: string;
  reference?: string | null;
  paidAt?: Date;
  notes?: string | null;
  userId?: string | null;
  actorEmail?: string | null;
  /** Credits applied from the customer's balance never create a new credit. */
  isCredit?: boolean;
}

@Injectable()
export class InvoicePaymentsService {
  constructor(private readonly audit: AuditLogService) {}

  /**
   * Applies money received against an invoice, inside the caller's transaction:
   *  - locks the invoice row (SELECT … FOR UPDATE) so concurrent payments can't double count;
   *  - applies the early-pay discount when this payment settles the invoice inside the window;
   *  - records the portion up to the balance as an InvoicePayment (+ receipt);
   *  - turns any overpayment into an OPEN CustomerCredit (spec §4 customer_credits);
   *  - recomputes paidAmount / status.
   */
  async applyPaymentTx(tx: Tx, invoiceId: string, input: ApplyPaymentInput) {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.docType === 'QUOTE') throw new BadRequestException('Convert the quote to an invoice before recording payments');
    if (inv.status === 'VOID') throw new BadRequestException('Cannot record a payment against a voided invoice');
    if (inv.status === 'DRAFT') throw new BadRequestException('Issue the invoice before recording payments');

    const amount = round2(input.amount);
    if (!(amount > 0)) throw new BadRequestException('Amount must be greater than zero');
    const paidAt = input.paidAt ?? new Date();

    let amountDue = Number(inv.amountDue);
    const paid = Number(inv.paidAmount);
    let earlyPayDiscountAmount = Number(inv.earlyPayDiscountAmount);

    // Early-payment discount: only once, only if this payment clears the (discounted) balance
    // within N days of the issue date.
    const pct = Number(inv.earlyPayDiscountPercent ?? 0);
    if (pct > 0 && earlyPayDiscountAmount === 0 && inv.earlyPayDiscountDays != null) {
      const windowEnd = addDays(inv.issueDate, inv.earlyPayDiscountDays);
      windowEnd.setHours(23, 59, 59, 999);
      if (paidAt <= windowEnd) {
        const discount = round2((Number(inv.total) - Number(inv.whtTotal)) * (pct / 100));
        if (paid + amount + 0.005 >= amountDue - discount) {
          earlyPayDiscountAmount = discount;
          amountDue = round2(Math.max(0, amountDue - discount));
        }
      }
    }

    const balance = round2(Math.max(0, amountDue - paid));
    const applied = round2(Math.min(amount, balance));
    const excess = round2(amount - applied);

    let payment: Prisma.InvoicePaymentGetPayload<object> | null = null;
    let receipt: Prisma.PaymentReceiptGetPayload<object> | null = null;
    if (applied > 0) {
      payment = await tx.invoicePayment.create({
        data: {
          invoiceId,
          amount: applied,
          method: input.method,
          monnifyReference: input.reference ?? null,
          paidAt,
          notes:
            [input.notes, excess > 0 && !input.isCredit ? `Overpayment of ${excess.toFixed(2)} moved to customer credit` : null]
              .filter(Boolean)
              .join(' · ') || null,
          recordedById: input.userId ?? null,
        },
      });
      const seq = (await tx.paymentReceipt.count({ where: { invoiceId } })) + 1;
      receipt = await tx.paymentReceipt.create({
        data: {
          invoiceId,
          invoicePaymentId: payment.id,
          receiptNumber: `${inv.invoiceNumber ?? 'INV'}-R${String(seq).padStart(2, '0')}`,
        },
      });
    }

    let credit: Prisma.CustomerCreditGetPayload<object> | null = null;
    if (excess > 0 && !input.isCredit) {
      credit = await tx.customerCredit.create({
        data: {
          workspaceId: inv.workspaceId,
          customerId: inv.customerId,
          amount: excess,
          status: 'OPEN',
          sourceInvoiceId: invoiceId,
          note: `Overpayment on ${inv.invoiceNumber ?? 'invoice'}${input.reference ? ` (ref ${input.reference})` : ''}`,
        },
      });
    }

    const newPaid = round2(paid + applied);
    const status = deriveInvoiceStatus({ ...inv, amountDue, paidAmount: newPaid });
    const invoice = await tx.invoice.update({
      where: { id: invoiceId },
      data: { paidAmount: newPaid, amountDue, earlyPayDiscountAmount, status },
    });

    await this.audit.recordTx(
      tx,
      inv.workspaceId,
      input.userId ? { id: input.userId, email: input.actorEmail ?? undefined } : null,
      AUDIT_ACTIONS.INVOICE_PAYMENT_RECORDED,
      inv.invoiceNumber ?? invoiceId,
      { invoiceId, amount, applied, excess, method: input.method, reference: input.reference ?? null, creditId: credit?.id ?? null },
      { type: 'invoice', id: invoiceId },
    );

    return { payment, receipt, credit, invoice, applied, excess };
  }
}
