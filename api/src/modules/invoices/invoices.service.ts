import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Invoice, InvoiceStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../platform/audit-log.service';
import { EmailService } from '../email/email.service';
import { AUDIT_ACTIONS, CurrentUserData, paginate, runIdempotent } from '../../common';
import {
  CreateInvoiceDto,
  UpdateInvoiceDto,
  InvoiceFilterDto,
  RecordPaymentDto,
  SendInvoiceDto,
  CreateRecurrenceDto,
  FromTemplateDto,
  InvoiceItemDto,
} from './dto';
import { addDays, advanceByInterval, round2 } from './invoice-dates.util';
import { computeInvoiceTotals } from './invoice-calc.util';
import { DEFAULT_VAT_RATE, InvoiceConfigService, InvoiceSettings } from './invoice-config.service';
import { deriveInvoiceStatus, InvoicePaymentsService } from './invoice-payments.service';
import { InvoiceCollectionsService } from './invoice-collections.service';
import { InvoiceSheetsSyncService } from './invoice-sheets-sync.service';

const DEFAULT_DUE_DAYS = 14;
const DEFAULT_QUOTE_VALID_DAYS = 30;

type Tx = Prisma.TransactionClient;
type Actor = Pick<CurrentUserData, 'id' | 'email' | 'workspaceId'>;

export interface ResolvedLine {
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  whtRate: number;
}

const DETAIL_INCLUDE = {
  customer: true,
  items: { orderBy: { sortOrder: 'asc' } },
  payments: { orderBy: { paidAt: 'desc' } },
  sends: { orderBy: { sentAt: 'desc' } },
  sourceOfRecurrence: true,
  recurrence: true,
  sweeps: { orderBy: { matchedAt: 'desc' } },
  receipts: { orderBy: { createdAt: 'desc' } },
  creditsApplied: true,
  creditsCreated: true,
} satisfies Prisma.InvoiceInclude;

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: InvoiceConfigService,
    private readonly payments: InvoicePaymentsService,
    private readonly collections: InvoiceCollectionsService,
    private readonly sheets: InvoiceSheetsSyncService,
    private readonly audit: AuditLogService,
    private readonly email: EmailService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Read ────────────────────────────────────────────────────────────────

  async findAll(workspaceId: string, filter: InvoiceFilterDto) {
    const { page = 1, limit = 20, status, docType, customerId, search, startDate, endDate } = filter;
    const where: Prisma.InvoiceWhereInput = {
      workspaceId,
      ...(docType && { docType }),
      ...(status && { status: status === 'SENT' ? { in: ['SENT', 'PARTIALLY_PAID'] } : status }),
      ...(customerId && { customerId }),
      ...(search && {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { quoteNumber: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
      ...((startDate || endDate) && {
        issueDate: { ...(startDate && { gte: startDate }), ...(endDate && { lte: endDate }) },
      }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        include: { customer: { select: { id: true, name: true, email: true, phone: true } } },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return paginate(rows.map((r) => this.decorate(r)), total, page, limit);
  }

  /** KPIs: Paid this month, Outstanding, Overdue (spec §5.8). */
  async summary(workspaceId: string) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [paid, open] = await Promise.all([
      this.prisma.invoicePayment.aggregate({
        where: { invoice: { workspaceId }, paidAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.invoice.findMany({
        where: { workspaceId, docType: 'INVOICE', status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } },
        select: { status: true, amountDue: true, paidAmount: true },
      }),
    ]);
    let outstanding = 0;
    let overdue = 0;
    let overdueCount = 0;
    for (const i of open) {
      const bal = Math.max(0, Number(i.amountDue) - Number(i.paidAmount));
      outstanding += bal;
      if (i.status === 'OVERDUE') {
        overdue += bal;
        overdueCount++;
      }
    }
    return {
      paidThisMonth: round2(Number(paid._sum.amount ?? 0)),
      outstanding: round2(outstanding),
      outstandingCount: open.length,
      overdue: round2(overdue),
      overdueCount,
    };
  }

  async findOne(id: string, workspaceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id, workspaceId }, include: DETAIL_INCLUDE });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return this.decorate(invoice);
  }

  async findRaw(id: string, workspaceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id, workspaceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async findReceipt(invoiceId: string, receiptId: string, workspaceId: string) {
    const receipt = await this.prisma.paymentReceipt.findFirst({
      where: { id: receiptId, invoiceId, invoice: { workspaceId } },
      include: { invoice: { include: { customer: true } }, invoicePayment: true },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    return receipt;
  }

  listSends(id: string, workspaceId: string) {
    return this.prisma.invoiceSend.findMany({ where: { invoiceId: id, invoice: { workspaceId } }, orderBy: { sentAt: 'desc' } });
  }

  /** Adds balance, number, expiry and share URL to an invoice row. */
  decorate<T extends Invoice>(inv: T) {
    const balance = round2(Math.max(0, Number(inv.amountDue) - Number(inv.paidAmount)));
    return {
      ...inv,
      number: inv.docType === 'QUOTE' ? inv.quoteNumber : inv.invoiceNumber ?? inv.quoteNumber,
      balance,
      isQuoteExpired: inv.docType === 'QUOTE' && !!inv.quoteExpiresAt && inv.quoteExpiresAt < new Date(),
      shareUrl: inv.shareToken ? this.shareUrl(inv.shareToken) : null,
    };
  }

  // ─── Create / edit ───────────────────────────────────────────────────────

  async create(user: Actor, dto: CreateInvoiceDto) {
    const workspaceId = user.workspaceId;
    const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, workspaceId } });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.isArchived) throw new BadRequestException('Customer is archived; restore it first');

    const settings = await this.config.getSettings(workspaceId);
    const lines = await this.resolveLines(workspaceId, dto.items, settings);
    const docType = dto.docType ?? 'INVOICE';
    const issueDate = startOfDay(dto.issueDate ?? new Date());
    const dueDays = dto.dueDays ?? (dto.dueDate ? null : DEFAULT_DUE_DAYS);
    const dueDate = dto.dueDate ?? addDays(issueDate, dueDays ?? DEFAULT_DUE_DAYS);
    const totals = computeInvoiceTotals(lines, {
      taxInclusive: dto.taxInclusive,
      discountType: dto.discountType ?? null,
      discountValue: dto.discountValue,
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const prefix = docType === 'QUOTE' ? settings.quotePrefix : settings.invoicePrefix;
      const number = await this.config.nextNumber(tx, workspaceId, prefix);
      return tx.invoice.create({
        data: {
          workspaceId,
          docType,
          invoiceNumber: docType === 'INVOICE' ? number : null,
          quoteNumber: docType === 'QUOTE' ? number : null,
          quoteExpiresAt: docType === 'QUOTE' ? dto.quoteExpiresAt ?? addDays(issueDate, DEFAULT_QUOTE_VALID_DAYS) : null,
          customerId: customer.id,
          customerAddress: dto.customerAddress ?? customer.address ?? null,
          customerTin: dto.customerTin ?? customer.taxId ?? null,
          workspaceTin: dto.workspaceTin ?? settings.workspaceTin,
          status: 'DRAFT',
          issueDate,
          dueDate,
          dueDays,
          currency: (dto.currency ?? 'NGN').toUpperCase(),
          fxRate: dto.fxRate ?? null,
          fxBaseCurrency: dto.fxBaseCurrency?.toUpperCase() ?? null,
          taxInclusive: dto.taxInclusive ?? false,
          discountType: dto.discountType ?? null,
          discountValue: dto.discountValue ?? 0,
          discountAmount: totals.discountAmount,
          subtotal: totals.subtotal,
          vatTotal: totals.vatTotal,
          whtTotal: totals.whtTotal,
          total: totals.total,
          amountDue: totals.amountDue,
          lateFeePercent: dto.lateFeePercent ?? null,
          lateFeeFlat: dto.lateFeeFlat ?? null,
          lateFeeGraceDays: dto.lateFeeGraceDays ?? null,
          earlyPayDiscountPercent: dto.earlyPayDiscountPercent ?? null,
          earlyPayDiscountDays: dto.earlyPayDiscountDays ?? null,
          notes: dto.notes ?? null,
          terms: dto.terms ?? settings.defaultTerms,
          templateId: dto.templateId ?? null,
          createdById: user.id || null,
          items: { create: lines.map((l, i) => ({ ...l, lineTotal: totals.lines[i].lineTotal, sortOrder: i })) },
        },
      });
    });

    if (dto.issue) return this.issue(user, created.id);
    this.sheets.sync(workspaceId, created.id);
    return this.findOne(created.id, workspaceId);
  }

  async update(user: Actor, id: string, dto: UpdateInvoiceDto) {
    const workspaceId = user.workspaceId;
    const inv = await this.findRaw(id, workspaceId);
    if (inv.status !== 'DRAFT') throw new BadRequestException('Only drafts can be edited');
    if (dto.docType && dto.docType !== inv.docType) {
      throw new BadRequestException('Use "convert to invoice" to turn a quote into an invoice');
    }

    let customer = null;
    if (dto.customerId && dto.customerId !== inv.customerId) {
      customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, workspaceId } });
      if (!customer) throw new NotFoundException('Customer not found');
    }

    const settings = await this.config.getSettings(workspaceId);
    const existingItems = await this.prisma.invoiceItem.findMany({ where: { invoiceId: id }, orderBy: { sortOrder: 'asc' } });
    const lines: ResolvedLine[] = dto.items
      ? await this.resolveLines(workspaceId, dto.items, settings)
      : existingItems.map((it) => ({
          productId: it.productId,
          description: it.description,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          vatRate: Number(it.vatRate),
          whtRate: Number(it.whtRate),
        }));

    const taxInclusive = dto.taxInclusive ?? inv.taxInclusive;
    const discountType = dto.discountType !== undefined ? dto.discountType : inv.discountType;
    const discountValue = dto.discountValue ?? Number(inv.discountValue);
    const totals = computeInvoiceTotals(lines, { taxInclusive, discountType, discountValue });

    const issueDate = dto.issueDate ? startOfDay(dto.issueDate) : inv.issueDate;
    let dueDays = inv.dueDays;
    let dueDate = inv.dueDate;
    if (dto.dueDate) {
      dueDate = dto.dueDate;
      dueDays = dto.dueDays ?? null;
    } else if (dto.dueDays !== undefined) {
      dueDays = dto.dueDays;
      dueDate = addDays(issueDate, dto.dueDays);
    } else if (dto.issueDate && dueDays != null) {
      dueDate = addDays(issueDate, dueDays);
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
        await tx.invoiceItem.createMany({
          data: lines.map((l, i) => ({ ...l, invoiceId: id, lineTotal: totals.lines[i].lineTotal, sortOrder: i })),
        });
      }
      await tx.invoice.update({
        where: { id },
        data: {
          ...(customer && {
            customerId: customer.id,
            customerAddress: dto.customerAddress ?? customer.address ?? null,
            customerTin: dto.customerTin ?? customer.taxId ?? null,
          }),
          ...(dto.customerAddress !== undefined && { customerAddress: dto.customerAddress }),
          ...(dto.customerTin !== undefined && { customerTin: dto.customerTin }),
          ...(dto.workspaceTin !== undefined && { workspaceTin: dto.workspaceTin }),
          issueDate,
          dueDate,
          dueDays,
          ...(dto.quoteExpiresAt !== undefined && inv.docType === 'QUOTE' && { quoteExpiresAt: dto.quoteExpiresAt }),
          ...(dto.currency && { currency: dto.currency.toUpperCase() }),
          ...(dto.fxRate !== undefined && { fxRate: dto.fxRate }),
          ...(dto.fxBaseCurrency !== undefined && { fxBaseCurrency: dto.fxBaseCurrency?.toUpperCase() ?? null }),
          taxInclusive,
          discountType,
          discountValue,
          discountAmount: totals.discountAmount,
          subtotal: totals.subtotal,
          vatTotal: totals.vatTotal,
          whtTotal: totals.whtTotal,
          total: totals.total,
          amountDue: totals.amountDue,
          ...(dto.lateFeePercent !== undefined && { lateFeePercent: dto.lateFeePercent }),
          ...(dto.lateFeeFlat !== undefined && { lateFeeFlat: dto.lateFeeFlat }),
          ...(dto.lateFeeGraceDays !== undefined && { lateFeeGraceDays: dto.lateFeeGraceDays }),
          ...(dto.earlyPayDiscountPercent !== undefined && { earlyPayDiscountPercent: dto.earlyPayDiscountPercent }),
          ...(dto.earlyPayDiscountDays !== undefined && { earlyPayDiscountDays: dto.earlyPayDiscountDays }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.terms !== undefined && { terms: dto.terms }),
        },
      });
    });

    if (dto.issue) return this.issue(user, id);
    this.sheets.sync(workspaceId, id);
    return this.findOne(id, workspaceId);
  }

  /**
   * Resolves editor lines: product lines inherit description / unit price / VAT from the catalog;
   * VAT defaults to 7.5% when the workspace "VAT on new invoices" setting is on.
   */
  async resolveLines(workspaceId: string, items: InvoiceItemDto[], settings: InvoiceSettings): Promise<ResolvedLine[]> {
    const productIds = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))];
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { workspaceId, id: { in: productIds } } })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    const defaultVat = settings.vatOnNewInvoices ? settings.defaultVatRate || DEFAULT_VAT_RATE : 0;

    return items.map((it, idx) => {
      const product = it.productId ? byId.get(it.productId) : undefined;
      if (it.productId && !product) throw new BadRequestException(`Line ${idx + 1}: product not found`);
      const description = (it.description ?? '').trim() || product?.name || '';
      if (!description) throw new BadRequestException(`Line ${idx + 1}: description or product is required`);
      const unitPrice = it.unitPrice ?? (product ? Number(product.unitPrice) : undefined);
      if (unitPrice === undefined) throw new BadRequestException(`Line ${idx + 1}: unit price is required`);
      return {
        productId: product?.id ?? null,
        description,
        quantity: it.quantity,
        unitPrice,
        vatRate: it.vatRate ?? (product ? Number(product.taxRate) : defaultVat),
        whtRate: it.whtRate ?? 0,
      };
    });
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /** Save & issue: DRAFT → SENT (open). Invoices get a dedicated collection account. */
  async issue(user: Actor, id: string) {
    const inv = await this.findRaw(id, user.workspaceId);
    if (inv.status !== 'DRAFT') throw new BadRequestException(`Already issued (${inv.status})`);
    await this.prisma.$transaction(async (tx) => {
      const status = deriveInvoiceStatus({ ...inv, status: 'SENT', amountDue: Number(inv.amountDue), paidAmount: Number(inv.paidAmount) });
      await tx.invoice.update({
        where: { id },
        data: { status, shareToken: inv.shareToken ?? newShareToken() },
      });
      await this.audit.recordTx(
        tx,
        user.workspaceId,
        user,
        AUDIT_ACTIONS.INVOICE_ISSUED,
        inv.invoiceNumber ?? inv.quoteNumber,
        { invoiceId: id, docType: inv.docType, total: Number(inv.total), amountDue: Number(inv.amountDue) },
        { type: 'invoice', id },
      );
    });
    if (inv.docType === 'INVOICE') await this.collections.ensureCollectionAccount(id);
    this.sheets.sync(user.workspaceId, id);
    return this.findOne(id, user.workspaceId);
  }

  async markSent(user: Actor, id: string) {
    const inv = await this.findRaw(id, user.workspaceId);
    if (inv.status === 'VOID') throw new BadRequestException('Invoice is void');
    if (inv.status === 'DRAFT') await this.issue(user, id);
    await this.prisma.invoice.update({ where: { id }, data: { sentAt: new Date() } });
    this.sheets.sync(user.workspaceId, id);
    return this.findOne(id, user.workspaceId);
  }

  async void(user: Actor, id: string) {
    const inv = await this.findRaw(id, user.workspaceId);
    if (inv.status === 'VOID') return this.findOne(id, user.workspaceId);
    if (inv.status === 'PAID') throw new BadRequestException('A fully paid invoice cannot be voided');
    await this.prisma.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date() } });
      await this.audit.recordTx(
        tx,
        user.workspaceId,
        user,
        AUDIT_ACTIONS.INVOICE_VOIDED,
        inv.invoiceNumber ?? inv.quoteNumber,
        { invoiceId: id, paidAmount: Number(inv.paidAmount) },
        { type: 'invoice', id },
      );
    });
    this.sheets.sync(user.workspaceId, id);
    return this.findOne(id, user.workspaceId);
  }

  /** Delete: blocked when payments exist unless `force` (the UI's "this invoice has payments" warning). */
  async remove(user: Actor, id: string, force = false) {
    const inv = await this.findRaw(id, user.workspaceId);
    const paymentCount = await this.prisma.invoicePayment.count({ where: { invoiceId: id } });
    if (paymentCount > 0 && !force) {
      throw new ConflictException(
        `This invoice has ${paymentCount} payment(s) recorded. Deleting it also deletes those payment records — confirm with force=true, or void it instead.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      // Credits applied to this invoice go back to the customer's open balance.
      await tx.customerCredit.updateMany({
        where: { appliedToInvoiceId: id },
        data: { status: 'OPEN', appliedToInvoiceId: null, appliedAt: null },
      });
      await tx.invoice.delete({ where: { id } });
      await this.audit.recordTx(tx, user.workspaceId, user, 'invoice.deleted', inv.invoiceNumber ?? inv.quoteNumber, {
        invoiceId: id,
        status: inv.status,
        paymentCount,
        total: Number(inv.total),
      });
    });
    return { message: 'Invoice deleted successfully' };
  }

  /** Copies the invoice (lines + settings) into a new draft with a fresh number. */
  async duplicate(user: Actor, id: string) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id, workspaceId: user.workspaceId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return this.create(user, {
      ...this.editorFields(inv),
      docType: inv.docType,
      customerId: inv.customerId,
      issueDate: new Date(),
      dueDays: inv.dueDays ?? DEFAULT_DUE_DAYS,
      items: inv.items.map((it) => ({
        productId: it.productId ?? undefined,
        description: it.description,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        vatRate: Number(it.vatRate),
        whtRate: Number(it.whtRate),
      })),
    });
  }

  async saveAsTemplate(user: Actor, id: string, name: string) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id, workspaceId: user.workspaceId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    const { notes, terms, currency, ...settings } = this.editorFields(inv);
    return this.prisma.invoiceTemplate.create({
      data: {
        workspaceId: user.workspaceId,
        name,
        notes: notes ?? null,
        terms: terms ?? null,
        currency: currency ?? null,
        settings: { ...settings, dueDays: inv.dueDays ?? DEFAULT_DUE_DAYS } as Prisma.InputJsonValue,
        items: {
          create: inv.items.map((it, i) => ({
            productId: it.productId,
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            vatRate: it.vatRate,
            whtRate: it.whtRate,
            sortOrder: i,
          })),
        },
      },
      include: { items: true },
    });
  }

  async fromTemplate(user: Actor, templateId: string, dto: FromTemplateDto) {
    const template = await this.prisma.invoiceTemplate.findFirst({
      where: { id: templateId, workspaceId: user.workspaceId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) throw new NotFoundException('Invoice template not found');
    const s = (template.settings ?? {}) as Partial<CreateInvoiceDto>;
    return this.create(user, {
      taxInclusive: s.taxInclusive,
      discountType: s.discountType,
      discountValue: s.discountValue,
      lateFeePercent: s.lateFeePercent,
      lateFeeFlat: s.lateFeeFlat,
      lateFeeGraceDays: s.lateFeeGraceDays,
      earlyPayDiscountPercent: s.earlyPayDiscountPercent,
      earlyPayDiscountDays: s.earlyPayDiscountDays,
      dueDays: s.dueDays,
      fxRate: s.fxRate,
      fxBaseCurrency: s.fxBaseCurrency,
      customerId: dto.customerId,
      issueDate: dto.issueDate ?? new Date(),
      currency: template.currency ?? undefined,
      notes: template.notes ?? undefined,
      terms: template.terms ?? undefined,
      templateId: template.id,
      items: template.items.map((it) => ({
        productId: it.productId ?? undefined,
        description: it.description,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        vatRate: Number(it.vatRate),
        whtRate: Number(it.whtRate),
      })),
    });
  }

  /** Converts a quote into an invoice in place, allocating a new invoice number (quote number kept). */
  async convertQuote(user: Actor, id: string, issue = false) {
    const inv = await this.findRaw(id, user.workspaceId);
    if (inv.docType !== 'QUOTE') throw new BadRequestException('Only quotes can be converted');
    if (inv.status === 'VOID') throw new BadRequestException('Quote is void');
    const settings = await this.config.getSettings(user.workspaceId);
    const issueDate = startOfDay(new Date());
    const dueDays = inv.dueDays ?? DEFAULT_DUE_DAYS;
    await this.prisma.$transaction(async (tx) => {
      const number = await this.config.nextNumber(tx, user.workspaceId, settings.invoicePrefix);
      await tx.invoice.update({
        where: { id },
        data: {
          docType: 'INVOICE',
          invoiceNumber: number,
          convertedFromQuoteId: id,
          status: 'DRAFT',
          issueDate,
          dueDays,
          dueDate: addDays(issueDate, dueDays),
        },
      });
      await this.audit.recordTx(tx, user.workspaceId, user, 'invoice.quote_converted', number, {
        invoiceId: id,
        quoteNumber: inv.quoteNumber,
      });
    });
    if (issue) return this.issue(user, id);
    this.sheets.sync(user.workspaceId, id);
    return this.findOne(id, user.workspaceId);
  }

  // ─── Money ───────────────────────────────────────────────────────────────

  async recordPayment(user: Actor, id: string, dto: RecordPaymentDto) {
    await this.findRaw(id, user.workspaceId);
    const run = (tx: Tx) =>
      this.payments.applyPaymentTx(tx, id, {
        amount: dto.amount,
        method: dto.method ?? 'TRANSFER',
        reference: dto.reference,
        paidAt: dto.paymentDate,
        notes: dto.notes,
        userId: user.id,
        actorEmail: user.email,
      });
    const result = dto.clientRequestId
      ? await runIdempotent(this.prisma, user.workspaceId, `invoice.payment:${id}`, dto.clientRequestId, run)
      : await this.prisma.$transaction(run);
    this.sheets.sync(user.workspaceId, id);
    return result;
  }

  /** Applies an OPEN customer credit to an invoice (splitting the credit if it exceeds the balance). */
  async applyCredit(user: Actor, id: string, creditId: string) {
    const inv = await this.findRaw(id, user.workspaceId);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customer_credits WHERE id = ${creditId} FOR UPDATE`;
      const credit = await tx.customerCredit.findFirst({ where: { id: creditId, workspaceId: user.workspaceId } });
      if (!credit) throw new NotFoundException('Credit not found');
      if (credit.status !== 'OPEN') throw new BadRequestException('Credit is not open');
      if (credit.customerId !== inv.customerId) throw new BadRequestException('Credit belongs to a different customer');
      const balance = round2(Number(inv.amountDue) - Number(inv.paidAmount));
      if (balance <= 0) throw new BadRequestException('Invoice has no balance to apply credit to');

      const creditAmount = Number(credit.amount);
      const use = round2(Math.min(creditAmount, balance));
      const remainder = round2(creditAmount - use);
      await tx.customerCredit.update({
        where: { id: credit.id },
        data: { status: 'APPLIED', amount: use, appliedToInvoiceId: id, appliedAt: new Date() },
      });
      let remainderCredit = null;
      if (remainder > 0) {
        remainderCredit = await tx.customerCredit.create({
          data: {
            workspaceId: credit.workspaceId,
            customerId: credit.customerId,
            amount: remainder,
            status: 'OPEN',
            sourceInvoiceId: credit.sourceInvoiceId,
            note: `Remainder of credit${credit.note ? `: ${credit.note}` : ''}`,
          },
        });
      }
      const pay = await this.payments.applyPaymentTx(tx, id, {
        amount: use,
        method: 'CREDIT',
        reference: `CREDIT-${credit.id.slice(0, 8)}`,
        notes: 'Customer credit applied',
        userId: user.id,
        actorEmail: user.email,
        isCredit: true,
      });
      return { ...pay, appliedCreditAmount: use, remainderCredit };
    });
    this.sheets.sync(user.workspaceId, id);
    return result;
  }

  // ─── Sending ─────────────────────────────────────────────────────────────

  shareUrl(token: string) {
    const base = (this.configService.get<string>('resend.frontendUrl') || 'http://localhost:5173').replace(/\/$/, '');
    return `${base}/i/${token}`;
  }

  async getShareLink(user: Actor, id: string) {
    const inv = await this.findRaw(id, user.workspaceId);
    if (inv.status === 'DRAFT') throw new BadRequestException('Issue the invoice before sharing it');
    let token = inv.shareToken;
    if (!token) {
      token = newShareToken();
      await this.prisma.invoice.update({ where: { id }, data: { shareToken: token } });
    }
    return { token, url: this.shareUrl(token) };
  }

  /** Email (with CC) via EmailService, or a wa.me link for WhatsApp. Issues drafts first. */
  async send(user: Actor, id: string, dto: SendInvoiceDto) {
    let inv = await this.prisma.invoice.findFirst({ where: { id, workspaceId: user.workspaceId }, include: { customer: true } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status === 'VOID') throw new BadRequestException('Invoice is void');
    if (inv.status === 'DRAFT') {
      await this.issue(user, id);
      inv = (await this.prisma.invoice.findUnique({ where: { id }, include: { customer: true } }))!;
    }
    const { url } = await this.getShareLink(user, id);
    const ws = await this.prisma.workspace.findUnique({ where: { id: user.workspaceId }, select: { name: true } });
    const number = (inv.docType === 'QUOTE' ? inv.quoteNumber : inv.invoiceNumber) ?? '';
    const label = inv.docType === 'QUOTE' ? 'Quote' : 'Invoice';
    const balance = round2(Number(inv.amountDue) - Number(inv.paidAmount));
    const channel = dto.channel ?? 'EMAIL';

    if (channel === 'WHATSAPP') {
      const phone = normalisePhone(dto.recipient ?? inv.customer.phone ?? '');
      const text =
        (dto.message?.trim() ? `${dto.message.trim()}\n\n` : `Hello ${inv.customer.name}, here is ${label.toLowerCase()} ${number} from ${ws?.name} for ${formatMoney(balance > 0 ? balance : Number(inv.amountDue), inv.currency)}.\n\n`) +
        `View: ${url}`;
      const waLink = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      const send = await this.prisma.invoiceSend.create({ data: { invoiceId: id, channel: 'WHATSAPP', sentTo: phone || 'unspecified' } });
      await this.prisma.invoice.update({ where: { id }, data: { sentAt: new Date() } });
      this.sheets.sync(user.workspaceId, id);
      return { channel, waLink, shareUrl: url, send };
    }

    const to = (dto.recipient ?? inv.customer.email ?? '').trim();
    if (!to || !/^\S+@\S+\.\S+$/.test(to)) throw new BadRequestException('Customer has no email address; pass recipient');
    const cc = [...new Set((dto.cc ?? []).map((c) => c.trim().toLowerCase()).filter((c) => c && c !== to.toLowerCase()))];
    const payload = {
      clientName: inv.customer.name,
      invoiceNumber: number,
      workspaceName: ws?.name ?? 'Paid in Full',
      total: formatMoney(balance > 0 ? balance : Number(inv.amountDue), inv.currency),
      dueDate: inv.docType === 'QUOTE' ? formatDate(inv.quoteExpiresAt ?? inv.issueDate) : formatDate(inv.dueDate ?? inv.issueDate),
      paymentUrl: url,
    };
    // EmailService has no CC header support, so each CC gets its own copy of the same email.
    const failures: string[] = [];
    for (const addr of [to, ...cc]) {
      try {
        await this.email.send(addr, 'INVOICE_SENT', payload);
      } catch (err) {
        failures.push(addr);
        this.logger.warn(`Invoice email to ${addr} failed: ${(err as Error).message}`);
      }
    }
    if (failures.includes(to)) throw new BadRequestException(`Email to ${to} failed to send`);
    const send = await this.prisma.invoiceSend.create({
      data: { invoiceId: id, channel: 'EMAIL', sentTo: to, cc: cc.length ? cc.join(', ') : null },
    });
    await this.prisma.invoice.update({ where: { id }, data: { sentAt: new Date() } });
    this.sheets.sync(user.workspaceId, id);
    return { channel, shareUrl: url, send, ccFailures: failures };
  }

  // ─── Recurrence from an invoice ──────────────────────────────────────────

  async createRecurrence(user: Actor, id: string, dto: CreateRecurrenceDto) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id, workspaceId: user.workspaceId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    const existing = await this.prisma.invoiceRecurrence.findUnique({ where: { invoiceId: id } });
    if (existing) throw new ConflictException('This invoice already has a recurrence configured');
    return this.prisma.invoiceRecurrence.create({
      data: {
        workspaceId: user.workspaceId,
        customerId: inv.customerId,
        invoiceId: id,
        interval: dto.interval,
        nextRunAt: dto.nextRunAt ?? advanceByInterval(inv.issueDate, dto.interval),
        endsAt: dto.endsAt,
        dueDays: dto.dueDays ?? inv.dueDays ?? DEFAULT_DUE_DAYS,
        currency: inv.currency,
        notes: inv.notes,
        terms: inv.terms,
        templateItems: inv.items.map((it) => ({
          productId: it.productId,
          description: it.description,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          vatRate: Number(it.vatRate),
          whtRate: Number(it.whtRate),
        })),
      },
    });
  }

  // ─── Public (/i/:token) ──────────────────────────────────────────────────

  async getPublicView(token: string) {
    const inv = await this.prisma.invoice.findUnique({
      where: { shareToken: token },
      include: {
        customer: true,
        items: { orderBy: { sortOrder: 'asc' } },
        workspace: { select: { id: true, name: true, logoUrl: true } },
      },
    });
    if (!inv || inv.status === 'DRAFT') throw new NotFoundException('Invoice not found');
    const settings = await this.config.getSettings(inv.workspaceId);
    const balance = round2(Math.max(0, Number(inv.amountDue) - Number(inv.paidAmount)));
    const bank = inv.collectionAccountNumber
      ? {
          type: 'COLLECTION_ACCOUNT',
          bankName: inv.collectionBankName,
          accountNumber: inv.collectionAccountNumber,
          accountName: inv.collectionAccountName,
        }
      : settings.paymentAccount
        ? {
            type: 'PAYMENT_ACCOUNT',
            bankName: settings.paymentAccount.bankName ?? null,
            accountNumber: settings.paymentAccount.accountNumber,
            accountName: settings.paymentAccount.accountName,
          }
        : null;
    return {
      docType: inv.docType,
      number: inv.docType === 'QUOTE' ? inv.quoteNumber : inv.invoiceNumber,
      quoteNumber: inv.quoteNumber,
      status: inv.status,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      quoteExpiresAt: inv.quoteExpiresAt,
      isQuoteExpired: inv.docType === 'QUOTE' && !!inv.quoteExpiresAt && inv.quoteExpiresAt < new Date(),
      currency: inv.currency,
      taxInclusive: inv.taxInclusive,
      from: { name: inv.workspace.name, tin: inv.workspaceTin },
      billTo: {
        name: inv.customer.name,
        email: inv.customer.email,
        phone: inv.customer.phone,
        address: inv.customerAddress ?? inv.customer.address,
        tin: inv.customerTin,
      },
      items: inv.items.map((it) => ({
        description: it.description,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        vatRate: Number(it.vatRate),
        whtRate: Number(it.whtRate),
        lineTotal: Number(it.lineTotal),
      })),
      totals: {
        subtotal: Number(inv.subtotal),
        discountType: inv.discountType,
        discountValue: Number(inv.discountValue),
        discount: Number(inv.discountAmount),
        vat: Number(inv.vatTotal),
        total: Number(inv.total),
        lessWht: Number(inv.whtTotal),
        lateFee: Number(inv.lateFeeAmount),
        earlyPayDiscount: Number(inv.earlyPayDiscountAmount),
        amountDue: Number(inv.amountDue),
        paid: Number(inv.paidAmount),
        balance,
      },
      lateFee: { percent: numOrNull(inv.lateFeePercent), flat: numOrNull(inv.lateFeeFlat), graceDays: inv.lateFeeGraceDays },
      earlyPay: { percent: numOrNull(inv.earlyPayDiscountPercent), days: inv.earlyPayDiscountDays },
      bankDetails: bank,
      notes: inv.notes,
      terms: inv.terms,
      branding: { ...settings.branding, logoUrl: settings.branding.logoUrl ?? inv.workspace.logoUrl },
      signatureUrl: settings.branding.signatureUrl,
      poweredBy: 'Powered by Paid in Full',
    };
  }

  async findIdByShareToken(token: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { shareToken: token }, select: { id: true, workspaceId: true, status: true } });
    if (!inv || inv.status === 'DRAFT') throw new NotFoundException('Invoice not found');
    return inv;
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  private editorFields(inv: Invoice) {
    return {
      customerAddress: inv.customerAddress ?? undefined,
      customerTin: inv.customerTin ?? undefined,
      workspaceTin: inv.workspaceTin ?? undefined,
      currency: inv.currency,
      fxRate: numOrUndef(inv.fxRate),
      fxBaseCurrency: inv.fxBaseCurrency ?? undefined,
      taxInclusive: inv.taxInclusive,
      discountType: inv.discountType ?? undefined,
      discountValue: Number(inv.discountValue),
      lateFeePercent: numOrUndef(inv.lateFeePercent),
      lateFeeFlat: numOrUndef(inv.lateFeeFlat),
      lateFeeGraceDays: inv.lateFeeGraceDays ?? undefined,
      earlyPayDiscountPercent: numOrUndef(inv.earlyPayDiscountPercent),
      earlyPayDiscountDays: inv.earlyPayDiscountDays ?? undefined,
      notes: inv.notes ?? undefined,
      terms: inv.terms ?? undefined,
    };
  }
}

// ─── module-level helpers ──────────────────────────────────────────────────

export function newShareToken() {
  return randomBytes(18).toString('base64url');
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function numOrNull(v: Prisma.Decimal | null) {
  return v == null ? null : Number(v);
}

function numOrUndef(v: Prisma.Decimal | null) {
  return v == null ? undefined : Number(v);
}

/** Nigerian numbers to wa.me format (234XXXXXXXXXX). */
export function normalisePhone(raw: string) {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('0') && d.length === 11) d = `234${d.slice(1)}`;
  return d;
}

export function formatMoney(amount: number, currency = 'NGN') {
  const symbol = currency === 'NGN' ? '₦' : `${currency} `;
  return `${symbol}${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format(Math.round(amount))}`;
}

function formatDate(d: Date) {
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
}

export type { InvoiceStatus };
