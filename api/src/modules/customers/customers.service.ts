import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../platform/audit-log.service';
import { CurrentUserData, paginate } from '../../common';
import { CreateCustomerDto, UpdateCustomerDto, CustomerFilterDto, CreateCustomerCreditDto, CreditFilterDto } from './dto';

type Actor = Pick<CurrentUserData, 'id' | 'email' | 'workspaceId'>;

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogService,
  ) {}

  async findAll(workspaceId: string, filter: CustomerFilterDto) {
    const { page = 1, limit = 20, search, status = 'active' } = filter;
    const where: Prisma.CustomerWhereInput = {
      workspaceId,
      ...(status === 'active' && { isArchived: false }),
      ...(status === 'archived' && { isArchived: true }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { taxId: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
        include: { _count: { select: { invoices: true, subscriptions: true } } },
      }),
      this.prisma.customer.count({ where }),
    ]);

    // Outstanding balance + open credit per customer, for the Customers table.
    const ids = customers.map((c) => c.id);
    const [open, credits] = ids.length
      ? await Promise.all([
          this.prisma.invoice.findMany({
            where: { customerId: { in: ids }, docType: 'INVOICE', status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } },
            select: { customerId: true, amountDue: true, paidAmount: true },
          }),
          this.prisma.customerCredit.groupBy({
            by: ['customerId'],
            where: { customerId: { in: ids }, status: 'OPEN' },
            _sum: { amount: true },
          }),
        ])
      : [[], []];
    const outstanding = new Map<string, number>();
    for (const i of open) outstanding.set(i.customerId, (outstanding.get(i.customerId) ?? 0) + Number(i.amountDue) - Number(i.paidAmount));
    const creditMap = new Map(credits.map((c) => [c.customerId, Number(c._sum.amount ?? 0)]));

    return paginate(
      customers.map(({ _count, ...c }) => ({
        ...c,
        invoiceCount: _count.invoices,
        subscriptionCount: _count.subscriptions,
        outstanding: Math.round((outstanding.get(c.id) ?? 0) * 100) / 100,
        openCredit: creditMap.get(c.id) ?? 0,
      })),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string, workspaceId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, workspaceId },
      include: {
        credits: { orderBy: { createdAt: 'desc' } },
        invoices: {
          orderBy: { issueDate: 'desc' },
          take: 50,
          select: { id: true, docType: true, invoiceNumber: true, quoteNumber: true, status: true, issueDate: true, dueDate: true, amountDue: true, paidAmount: true, currency: true },
        },
        subscriptions: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async create(workspaceId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        email: dto.email?.trim().toLowerCase() || null,
        phone: dto.phone?.trim() || null,
        address: dto.address ?? null,
        taxId: dto.taxId?.trim() || null,
        notes: dto.notes ?? null,
      },
    });
  }

  async update(id: string, workspaceId: string, dto: UpdateCustomerDto) {
    await this.assertExists(id, workspaceId);
    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.email !== undefined && { email: dto.email?.trim().toLowerCase() || null }),
        ...(dto.phone !== undefined && { phone: dto.phone?.trim() || null }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.taxId !== undefined && { taxId: dto.taxId?.trim() || null }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async setArchived(user: Actor, id: string, archived: boolean) {
    const c = await this.assertExists(id, user.workspaceId);
    const updated = await this.prisma.customer.update({ where: { id }, data: { isArchived: archived } });
    await this.audit.record(user.workspaceId, user, archived ? 'customer.archived' : 'customer.restored', c.name, { customerId: id });
    return updated;
  }

  /** Delete only when the customer has no invoices (spec §5.8). */
  async remove(user: Actor, id: string) {
    const c = await this.assertExists(id, user.workspaceId);
    const invoiceCount = await this.prisma.invoice.count({ where: { customerId: id } });
    if (invoiceCount > 0) {
      throw new ConflictException(`This customer has ${invoiceCount} invoice(s) and can't be deleted. Archive it instead.`);
    }
    await this.prisma.customer.delete({ where: { id } });
    await this.audit.record(user.workspaceId, user, 'customer.deleted', c.name, { customerId: id });
    return { message: 'Customer deleted successfully' };
  }

  /**
   * merge_customers(keep_id, merge_id): moves invoices, credits, subscriptions and recurring
   * schedules to the kept customer, fills its blank fields from the duplicate, and archives the
   * duplicate (mergedIntoId set) so nothing points at it any more.
   */
  async merge(user: Actor, keepId: string, mergeId: string) {
    if (keepId === mergeId) throw new BadRequestException('Pick two different customers to merge');
    const [keep, dup] = await Promise.all([this.assertExists(keepId, user.workspaceId), this.assertExists(mergeId, user.workspaceId)]);
    if (dup.mergedIntoId) throw new BadRequestException('That customer was already merged');

    const moved = await this.prisma.$transaction(async (tx) => {
      const invoices = await tx.invoice.updateMany({ where: { customerId: mergeId, workspaceId: user.workspaceId }, data: { customerId: keepId } });
      const credits = await tx.customerCredit.updateMany({ where: { customerId: mergeId, workspaceId: user.workspaceId }, data: { customerId: keepId } });
      const subscriptions = await tx.customerSubscription.updateMany({ where: { customerId: mergeId, workspaceId: user.workspaceId }, data: { customerId: keepId } });
      const recurrences = await tx.invoiceRecurrence.updateMany({ where: { customerId: mergeId, workspaceId: user.workspaceId }, data: { customerId: keepId } });
      await tx.customer.update({
        where: { id: keepId },
        data: {
          email: keep.email ?? dup.email,
          phone: keep.phone ?? dup.phone,
          address: keep.address ?? dup.address,
          taxId: keep.taxId ?? dup.taxId,
          notes: [keep.notes, dup.notes ? `Merged from ${dup.name}: ${dup.notes}` : null].filter(Boolean).join('\n') || null,
        },
      });
      await tx.customer.update({ where: { id: mergeId }, data: { isArchived: true, mergedIntoId: keepId } });
      await this.audit.recordTx(tx, user.workspaceId, user, 'customer.merged', keep.name, {
        keepId,
        mergeId,
        mergedName: dup.name,
        invoices: invoices.count,
        credits: credits.count,
        subscriptions: subscriptions.count,
        recurrences: recurrences.count,
      });
      return { invoices: invoices.count, credits: credits.count, subscriptions: subscriptions.count, recurrences: recurrences.count };
    });
    return { customer: await this.findOne(keepId, user.workspaceId), moved };
  }

  // ─── Credits ───────────────────────────────────────────────────────────

  async listCredits(customerId: string, workspaceId: string) {
    await this.assertExists(customerId, workspaceId);
    return this.prisma.customerCredit.findMany({
      where: { customerId, workspaceId },
      orderBy: { createdAt: 'desc' },
      include: {
        sourceInvoice: { select: { id: true, invoiceNumber: true } },
        appliedToInvoice: { select: { id: true, invoiceNumber: true } },
      },
    });
  }

  /** Credits tab: all credits in the workspace. */
  async listAllCredits(workspaceId: string, filter: CreditFilterDto) {
    const { page = 1, limit = 20, status, customerId } = filter;
    const where: Prisma.CustomerCreditWhereInput = { workspaceId, ...(status && { status }), ...(customerId && { customerId }) };
    const [rows, total, openSum] = await Promise.all([
      this.prisma.customerCredit.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          sourceInvoice: { select: { id: true, invoiceNumber: true } },
          appliedToInvoice: { select: { id: true, invoiceNumber: true } },
        },
      }),
      this.prisma.customerCredit.count({ where }),
      this.prisma.customerCredit.aggregate({ where: { workspaceId, status: 'OPEN' }, _sum: { amount: true } }),
    ]);
    return { ...paginate(rows, total, page, limit), openTotal: Number(openSum._sum.amount ?? 0) };
  }

  async addCredit(user: Actor, customerId: string, dto: CreateCustomerCreditDto) {
    const c = await this.assertExists(customerId, user.workspaceId);
    const credit = await this.prisma.customerCredit.create({
      data: { workspaceId: user.workspaceId, customerId, amount: dto.amount, note: dto.reason, status: 'OPEN' },
    });
    await this.audit.record(user.workspaceId, user, 'customer.credit_added', c.name, { creditId: credit.id, amount: dto.amount });
    return credit;
  }

  /** Marks an open credit as refunded to the customer (money returned outside the app). */
  async refundCredit(user: Actor, creditId: string) {
    const credit = await this.prisma.customerCredit.findFirst({ where: { id: creditId, workspaceId: user.workspaceId } });
    if (!credit) throw new NotFoundException('Credit not found');
    if (credit.status !== 'OPEN') throw new BadRequestException('Only open credits can be refunded');
    const res = await this.prisma.customerCredit.updateMany({ where: { id: creditId, status: 'OPEN' }, data: { status: 'REFUNDED' } });
    if (!res.count) throw new BadRequestException('Credit is no longer open');
    await this.audit.record(user.workspaceId, user, 'customer.credit_refunded', creditId, { amount: Number(credit.amount) });
    return this.prisma.customerCredit.findUnique({ where: { id: creditId } });
  }

  private async assertExists(id: string, workspaceId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, workspaceId } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }
}
