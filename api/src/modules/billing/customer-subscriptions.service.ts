import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { CustomerSubscription, Customer, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../platform/audit-log.service';
import { CurrentUserData, decryptSecret, encryptSecret, paginate, runIdempotent } from '../../common';
import { InvoiceMonnifyClient } from '../invoices/invoice-monnify.client';
import { MonnifyHookEvent, registerMonnifyCollectionHook } from '../invoices/collection-hook';
import { advanceByInterval } from '../invoices/invoice-dates.util';
import {
  AuthoriseMandateDto,
  ChargeNowDto,
  CreateCustomerSubscriptionDto,
  SubscriptionFilterDto,
  UpdateCustomerSubscriptionDto,
} from './dto';

type Actor = Pick<CurrentUserData, 'id' | 'email' | 'workspaceId'>;
type SubWithCustomer = CustomerSubscription & { customer: Customer };

/** ₦50 card verification charge on /m/:token (spec §2). */
const CARD_VERIFICATION_AMOUNT = 50;
/** Scheduled charge attempts per billing cycle before moving to the next cycle. */
const MAX_ATTEMPTS_PER_CYCLE = 3;

/**
 * Client subscriptions & auto-debit mandates (spec §5.10 #18, #19; §2 /m/:token).
 *
 * Lifecycle: create plan (PENDING_MANDATE, authorisation token) → client opens /m/:token and
 * authorises a card (₦50 Monnify checkout; the webhook carries the card token) or a bank direct
 * debit (bank, NUBAN, phone, address) → ACTIVE → charged on schedule by the daily job or with
 * "Charge now" → cancel.
 */
@Injectable()
export class CustomerSubscriptionsService implements OnModuleInit {
  private readonly logger = new Logger(CustomerSubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly monnify: InvoiceMonnifyClient,
    private readonly audit: AuditLogService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    registerMonnifyCollectionHook('customer-subscriptions', (e) => this.handleWebhookEvent(e));
  }

  private get encKey(): string {
    return this.configService.get<string>('monnify.encryptionKey') || 'dev-only-insecure-key-change-me';
  }

  authorisationUrl(token: string) {
    const base = (this.configService.get<string>('resend.frontendUrl') || 'http://localhost:5173').replace(/\/$/, '');
    return `${base}/m/${token}`;
  }

  /** Never expose the encrypted card token. */
  private present<T extends CustomerSubscription>(s: T) {
    const { cardToken, authorisationToken, ...rest } = s;
    return {
      ...rest,
      hasCardToken: !!cardToken,
      authorisationUrl: authorisationToken && s.status === 'PENDING_MANDATE' ? this.authorisationUrl(authorisationToken) : null,
    };
  }

  // ─── Plans ───────────────────────────────────────────────────────────────

  async findAll(workspaceId: string, filter: SubscriptionFilterDto) {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const where: Prisma.CustomerSubscriptionWhereInput = { workspaceId, ...(filter.status && { status: filter.status }) };
    const [data, total] = await Promise.all([
      this.prisma.customerSubscription.findMany({
        where,
        include: { customer: { select: { id: true, name: true, email: true, phone: true } }, charges: { orderBy: { attemptedAt: 'desc' }, take: 1 } },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customerSubscription.count({ where }),
    ]);
    return paginate(data.map((s) => this.present(s)), total, page, limit);
  }

  async findOne(workspaceId: string, id: string) {
    const record = await this.prisma.customerSubscription.findFirst({
      where: { id, workspaceId },
      include: { customer: true, charges: { orderBy: { attemptedAt: 'desc' }, take: 50 } },
    });
    if (!record) throw new NotFoundException('Client subscription not found');
    return this.present(record);
  }

  private async raw(workspaceId: string, id: string): Promise<SubWithCustomer> {
    const s = await this.prisma.customerSubscription.findFirst({ where: { id, workspaceId }, include: { customer: true } });
    if (!s) throw new NotFoundException('Client subscription not found');
    return s;
  }

  async create(user: Actor, dto: CreateCustomerSubscriptionDto) {
    const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, workspaceId: user.workspaceId } });
    if (!customer) throw new NotFoundException('Customer not found in this workspace');
    const sub = await this.prisma.customerSubscription.create({
      data: {
        workspaceId: user.workspaceId,
        customerId: dto.customerId,
        planName: dto.planName.trim(),
        description: dto.description ?? null,
        interval: dto.interval,
        amount: dto.amount,
        status: 'PENDING_MANDATE',
        authorisationToken: newToken(),
        nextRunAt: dto.startDate ?? new Date(),
        isActive: true,
      },
      include: { customer: true },
    });
    await this.audit.record(user.workspaceId, user, 'subscription.created', sub.planName, {
      subscriptionId: sub.id,
      customer: customer.name,
      amount: dto.amount,
      interval: dto.interval,
    });
    return this.present(sub);
  }

  async update(user: Actor, id: string, dto: UpdateCustomerSubscriptionDto) {
    const sub = await this.raw(user.workspaceId, id);
    if (sub.status === 'CANCELLED') throw new BadRequestException('Subscription is cancelled');
    if (dto.customerId && dto.customerId !== sub.customerId) {
      if (sub.status !== 'PENDING_MANDATE') throw new BadRequestException('Cannot change the client after the mandate is authorised');
      const c = await this.prisma.customer.findFirst({ where: { id: dto.customerId, workspaceId: user.workspaceId } });
      if (!c) throw new NotFoundException('Customer not found');
    }
    const updated = await this.prisma.customerSubscription.update({
      where: { id },
      data: {
        ...(dto.customerId && { customerId: dto.customerId }),
        ...(dto.planName !== undefined && { planName: dto.planName }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.interval !== undefined && { interval: dto.interval }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.startDate !== undefined && { nextRunAt: dto.startDate }),
      },
      include: { customer: true },
    });
    return this.present(updated);
  }

  /** "Generate authorisation link": returns /m/:token (rotates the token on regenerate=true). */
  async authorisationLink(user: Actor, id: string, regenerate = false) {
    const sub = await this.raw(user.workspaceId, id);
    if (sub.status === 'CANCELLED') throw new BadRequestException('Subscription is cancelled');
    if (sub.status === 'ACTIVE') throw new BadRequestException('Mandate already authorised');
    let token = sub.authorisationToken;
    if (!token || regenerate) {
      token = newToken();
      await this.prisma.customerSubscription.update({ where: { id }, data: { authorisationToken: token } });
    }
    const url = this.authorisationUrl(token);
    const phone = (sub.customer.phone ?? '').replace(/\D/g, '').replace(/^0(\d{10})$/, '234$1');
    const text = `Hello ${sub.customer.name}, please authorise your ${sub.planName ?? 'subscription'} auto-debit here: ${url}`;
    return { token, url, waLink: `https://wa.me/${phone}?text=${encodeURIComponent(text)}` };
  }

  /** Cancel the plan (and any mandate). */
  async cancel(user: Actor, id: string, reason = 'subscription.cancelled') {
    const sub = await this.raw(user.workspaceId, id);
    if (sub.status === 'CANCELLED') return this.findOne(user.workspaceId, id);
    if (sub.mandateType === 'DIRECT_DEBIT' && sub.mandateId) await this.monnify.cancelMandate(sub.mandateId);
    await this.prisma.customerSubscription.update({
      where: { id },
      data: { status: 'CANCELLED', isActive: false, cancelledAt: new Date(), cardToken: null, authorisationToken: null },
    });
    await this.audit.record(user.workspaceId, user, reason, sub.planName, { subscriptionId: id, mandateType: sub.mandateType });
    return this.findOne(user.workspaceId, id);
  }

  cancelMandate(user: Actor, id: string) {
    return this.cancel(user, id, 'mandate.cancelled');
  }

  async remove(user: Actor, id: string) {
    const sub = await this.raw(user.workspaceId, id);
    if (sub.status === 'ACTIVE') throw new BadRequestException('Cancel the mandate before deleting');
    const charges = await this.prisma.customerSubscriptionCharge.count({ where: { subscriptionId: id, status: 'SUCCESS' } });
    if (charges > 0) throw new BadRequestException('This subscription has successful charges; it can be cancelled but not deleted');
    await this.prisma.customerSubscription.delete({ where: { id } });
    return { success: true };
  }

  // ─── Mandates & charges ──────────────────────────────────────────────────

  /** Client Mandates: subscriptions with an authorised (or previously authorised) mandate. */
  async listMandates(workspaceId: string) {
    const rows = await this.prisma.customerSubscription.findMany({
      where: { workspaceId, mandateType: { not: null } },
      include: { customer: { select: { id: true, name: true, email: true } }, charges: { orderBy: { attemptedAt: 'desc' }, take: 5 } },
      orderBy: [{ status: 'asc' }, { authorisedAt: 'desc' }],
    });
    return rows.map((s) => this.present(s));
  }

  recentCharges(workspaceId: string, limit = 50) {
    return this.prisma.customerSubscriptionCharge.findMany({
      where: { subscription: { workspaceId } },
      include: { subscription: { select: { id: true, planName: true, mandateType: true, customer: { select: { id: true, name: true } } } } },
      orderBy: { attemptedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async chargeNow(user: Actor, id: string, dto: ChargeNowDto) {
    const sub = await this.raw(user.workspaceId, id);
    if (sub.status !== 'ACTIVE') throw new BadRequestException('Mandate is not active');
    const amount = dto.amount ?? Number(sub.amount);
    const doCharge = () => this.charge(sub, amount, user);
    if (!dto.clientRequestId) {
      // Guard against double taps: refuse while another charge on this mandate is still pending.
      const pending = await this.prisma.customerSubscriptionCharge.findFirst({
        where: { subscriptionId: id, status: 'PENDING', attemptedAt: { gte: new Date(Date.now() - 10 * 60_000) } },
      });
      if (pending) throw new BadRequestException('A charge on this mandate is already in progress');
      return doCharge();
    }
    // Idempotency: the key row is claimed in its own transaction; the Monnify call happens once.
    return runIdempotent(this.prisma, user.workspaceId, `subscription.charge:${id}`, dto.clientRequestId, async () => doCharge());
  }

  private async charge(sub: SubWithCustomer, amount: number, user: Actor | null) {
    const reference = `SUBC-${sub.id.slice(0, 8)}-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
    const charge = await this.prisma.customerSubscriptionCharge.create({
      data: { subscriptionId: sub.id, amount, reference, status: 'PENDING' },
    });
    let status: 'SUCCESS' | 'PENDING' | 'FAILED' = 'FAILED';
    let failureReason: string | undefined;
    try {
      const description = `${sub.planName ?? 'Subscription'} — ${sub.customer.name}`;
      if (sub.mandateType === 'CARD') {
        if (!sub.cardToken) throw new Error('No card token on file');
        const res = await this.monnify.chargeCardToken({
          cardToken: decryptSecret(sub.cardToken, this.encKey),
          amount,
          reference,
          customerEmail: sub.customer.email || `client-${sub.customerId.slice(0, 8)}@paidinfull.app`,
          customerName: sub.customer.name,
          description,
        });
        status = res.status;
        failureReason = res.message;
      } else if (sub.mandateType === 'DIRECT_DEBIT') {
        if (!sub.mandateId) throw new Error('No mandate id on file');
        const res = await this.monnify.debitMandate({
          mandateId: sub.mandateId,
          amount,
          reference,
          narration: description,
          customerEmail: sub.customer.email || `client-${sub.customerId.slice(0, 8)}@paidinfull.app`,
        });
        status = res.status;
        failureReason = res.message;
      } else {
        throw new Error('No mandate on file');
      }
    } catch (err) {
      status = 'FAILED';
      failureReason = (err as Error).message;
    }

    const updated = await this.settleCharge(charge.id, status, failureReason);
    await this.audit.record(sub.workspaceId, user, 'subscription.charged', sub.planName, {
      subscriptionId: sub.id,
      reference,
      amount,
      status,
      failureReason: failureReason ?? null,
      manual: !!user,
    });
    return updated;
  }

  private async settleCharge(chargeId: string, status: 'SUCCESS' | 'PENDING' | 'FAILED', failureReason?: string, net?: { fee?: number; net?: number }) {
    if (status === 'PENDING') return this.prisma.customerSubscriptionCharge.findUnique({ where: { id: chargeId } });
    // Only a PENDING charge can settle (webhook + sync result can't both apply).
    const res = await this.prisma.customerSubscriptionCharge.updateMany({
      where: { id: chargeId, status: 'PENDING' },
      data: {
        status,
        failureReason: status === 'FAILED' ? failureReason ?? 'Declined' : null,
        settledAt: status === 'SUCCESS' ? new Date() : null,
        ...(net?.fee !== undefined && { feeAmount: net.fee }),
        ...(net?.net !== undefined && { netAmount: net.net }),
      },
    });
    const charge = await this.prisma.customerSubscriptionCharge.findUnique({ where: { id: chargeId } });
    if (res.count && status === 'SUCCESS' && charge) {
      await this.prisma.customerSubscription.update({ where: { id: charge.subscriptionId }, data: { lastChargedAt: new Date() } });
    }
    return charge;
  }

  // ─── Scheduled charging ──────────────────────────────────────────────────

  @Cron('0 8 * * *')
  async chargeDueSubscriptions() {
    const now = new Date();
    const due = await this.prisma.customerSubscription.findMany({
      where: { status: 'ACTIVE', isActive: true, nextRunAt: { lte: now } },
      include: { customer: true },
    });
    let charged = 0;
    for (const sub of due) {
      try {
        // Already attempted today? (cron + manual run on the same day)
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const today = await this.prisma.customerSubscriptionCharge.count({
          where: { subscriptionId: sub.id, attemptedAt: { gte: startOfDay }, status: { in: ['PENDING', 'SUCCESS', 'FAILED'] } },
        });
        if (today > 0) continue;

        const charge = await this.charge(sub, Number(sub.amount), null);
        const failedThisCycle = await this.prisma.customerSubscriptionCharge.count({
          where: { subscriptionId: sub.id, status: 'FAILED', attemptedAt: { gte: sub.nextRunAt } },
        });
        if (charge?.status !== 'FAILED' || failedThisCycle >= MAX_ATTEMPTS_PER_CYCLE) {
          let next = sub.nextRunAt;
          do next = advanceByInterval(next, sub.interval);
          while (next <= now);
          await this.prisma.customerSubscription.update({ where: { id: sub.id }, data: { nextRunAt: next } });
        }
        if (charge?.status === 'SUCCESS') charged++;
      } catch (err) {
        this.logger.error(`Scheduled charge for subscription ${sub.id} failed: ${(err as Error).message}`);
      }
    }
    if (due.length) this.logger.log(`Client subscriptions: ${charged}/${due.length} charged`);
    return { due: due.length, charged };
  }

  // ─── Public /m/:token ────────────────────────────────────────────────────

  private async byToken(token: string) {
    const sub = await this.prisma.customerSubscription.findUnique({
      where: { authorisationToken: token },
      include: { customer: true, workspace: { select: { id: true, name: true, logoUrl: true } } },
    });
    if (!sub) throw new NotFoundException('This authorisation link is invalid or has expired');
    return sub;
  }

  async getMandatePage(token: string) {
    const sub = await this.byToken(token);
    return {
      status: sub.status,
      planName: sub.planName,
      description: sub.description,
      amount: Number(sub.amount),
      frequency: sub.interval,
      firstChargeDate: sub.nextRunAt,
      currency: 'NGN',
      customer: { name: sub.customer.name, email: sub.customer.email, phone: sub.customer.phone, address: sub.customer.address },
      merchant: { name: sub.workspace.name, logoUrl: sub.workspace.logoUrl },
      mandateType: sub.mandateType,
      cardLast4: sub.cardLast4,
      cardVerificationAmount: CARD_VERIFICATION_AMOUNT,
      securedBy: 'Secured by Monnify',
    };
  }

  async authorise(token: string, dto: AuthoriseMandateDto) {
    const sub = await this.byToken(token);
    if (sub.status === 'CANCELLED') throw new BadRequestException('This subscription has been cancelled');
    if (sub.status === 'ACTIVE') throw new BadRequestException('This mandate is already authorised');

    if (dto.method === 'CARD') {
      const reference = `MNDV-${sub.id.slice(0, 8)}-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
      const email = sub.customer.email || dto.email;
      if (!email) throw new BadRequestException('An email address is required for card authorisation');
      const checkout = await this.monnify.initCheckout({
        amount: CARD_VERIFICATION_AMOUNT,
        reference,
        customerName: sub.customer.name,
        customerEmail: email,
        description: `Card authorisation for ${sub.planName ?? 'subscription'} (${sub.workspace.name})`,
        redirectUrl: dto.redirectUrl ?? this.authorisationUrl(token),
        paymentMethods: ['CARD'],
        metaData: { subscriptionId: sub.id, purpose: 'MANDATE_VERIFICATION' },
      });
      await this.prisma.customerSubscription.update({ where: { id: sub.id }, data: { mandateReference: reference } });
      if (this.monnify.isMock) {
        // Stand-in for Monnify's SUCCESSFUL_TRANSACTION webhook after the customer pays ₦50.
        setTimeout(() => {
          this.handleWebhookEvent({
            eventType: 'SUCCESSFUL_TRANSACTION',
            data: {
              transactionReference: `MNFY|MOCK|${Date.now()}`,
              paymentReference: reference,
              amountPaid: CARD_VERIFICATION_AMOUNT,
              paymentMethod: 'CARD',
              cardDetails: { last4: '4242', cardToken: `MOCK-TOKEN-${randomBytes(6).toString('hex')}` },
            },
          }).catch((err) => this.logger.error(`Mock card verification failed: ${err.message}`));
        }, 3000);
      }
      return { method: 'CARD', status: 'PENDING_VERIFICATION', checkoutUrl: checkout.checkoutUrl, reference };
    }

    // Direct debit
    const mandateRef = `MDT-${sub.id.slice(0, 8)}-${Date.now().toString(36)}`;
    const res = await this.monnify.createDirectDebitMandate({
      reference: mandateRef,
      customerName: dto.accountName?.trim() || sub.customer.name,
      customerEmail: sub.customer.email || dto.email || `client-${sub.customerId.slice(0, 8)}@paidinfull.app`,
      customerPhone: dto.phone!,
      customerAddress: dto.address!,
      accountNumber: dto.accountNumber!,
      bankCode: dto.bankCode!,
      amount: Number(sub.amount),
      description: `${sub.planName ?? 'Subscription'} — ${sub.workspace.name}`,
      startDate: sub.nextRunAt > new Date() ? sub.nextRunAt : new Date(),
    });
    if (res.status === 'FAILED') throw new BadRequestException('The bank declined the direct debit mandate');
    const active = res.status === 'SUCCESS';
    await this.prisma.customerSubscription.update({
      where: { id: sub.id },
      data: {
        mandateType: 'DIRECT_DEBIT',
        mandateId: res.mandateId,
        mandateReference: mandateRef,
        mandateDetails: { bankCode: dto.bankCode, accountNumber: dto.accountNumber, phone: dto.phone, address: dto.address, accountName: dto.accountName ?? null },
        ...(active && { status: 'ACTIVE', authorisedAt: new Date(), nextRunAt: sub.nextRunAt > new Date() ? sub.nextRunAt : new Date() }),
      },
    });
    if (active) {
      await this.audit.record(sub.workspaceId, null, 'mandate.authorised', sub.planName, { subscriptionId: sub.id, mandateType: 'DIRECT_DEBIT' });
    }
    return {
      method: 'DIRECT_DEBIT',
      status: active ? 'ACTIVE' : 'PENDING_BANK_APPROVAL',
      authorizationLink: res.authorizationLink ?? null,
    };
  }

  // ─── Monnify webhook hook ────────────────────────────────────────────────

  /**
   * Claims card-verification (MNDV-…) and charge (SUBC-…) results.
   * UNVERIFIED: card token / last4 field names in the SUCCESSFUL_TRANSACTION payload
   * (cardDetails.cardToken, cardDetails.last4 / maskedPan) need confirming on a live contract.
   */
  async handleWebhookEvent(event: MonnifyHookEvent): Promise<boolean> {
    const d = event.data ?? {};
    const type = (event.eventType ?? '').toUpperCase();
    const ref: string | undefined = d.paymentReference ?? d.reference;
    if (!ref) return false;

    if (ref.startsWith('SUBC-')) {
      const charge = await this.prisma.customerSubscriptionCharge.findUnique({ where: { reference: ref } });
      if (!charge) return false;
      const failed = type.includes('FAIL') || ['FAILED', 'DECLINED'].includes(String(d.paymentStatus ?? '').toUpperCase());
      const fee = d.settlementAmount != null ? Number(d.amountPaid ?? charge.amount) - Number(d.settlementAmount) : undefined;
      await this.settleCharge(charge.id, failed ? 'FAILED' : 'SUCCESS', d.responseMessage ?? d.paymentDescription, {
        fee,
        net: d.settlementAmount != null ? Number(d.settlementAmount) : undefined,
      });
      return true;
    }

    if (ref.startsWith('MNDV-')) {
      const sub = await this.prisma.customerSubscription.findFirst({ where: { mandateReference: ref } });
      if (!sub) return false;
      if (sub.status !== 'PENDING_MANDATE') return true;
      const failed = type.includes('FAIL') || String(d.paymentStatus ?? '').toUpperCase() === 'FAILED';
      if (failed) {
        this.logger.warn(`Card verification ${ref} failed for subscription ${sub.id}`);
        return true;
      }
      const card = d.cardDetails ?? {};
      const token: string | undefined = card.cardToken ?? card.token ?? d.cardToken;
      const last4: string | undefined = card.last4 ?? (card.maskedPan ? String(card.maskedPan).slice(-4) : undefined);
      if (!token) {
        this.logger.warn(`Card verification ${ref} succeeded but carried no card token; mandate left pending`);
        return true;
      }
      const now = new Date();
      await this.prisma.customerSubscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          mandateType: 'CARD',
          cardToken: encryptSecret(token, this.encKey),
          cardLast4: last4 ?? null,
          authorisedAt: now,
          nextRunAt: sub.nextRunAt > now ? sub.nextRunAt : now,
        },
      });
      await this.audit.record(sub.workspaceId, null, 'mandate.authorised', sub.planName, { subscriptionId: sub.id, mandateType: 'CARD', last4 });
      return true;
    }
    return false;
  }
}

function newToken() {
  return randomBytes(18).toString('base64url');
}
