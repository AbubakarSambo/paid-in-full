import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MonnifyService } from '../monnify/monnify.service';
import { AuditLogService } from '../platform/audit-log.service';
import { runIdempotent } from '../../common';
import { ChargeSubscriptionDto, MonnifyWebhookDto, UpgradeSubscriptionDto } from './dto';
import { SubscriptionStatus, WorkspaceStatus } from '@prisma/client';
import { PIF_GRACE_DAYS, pifDueInfo, pifPaymentCoverage, subscriptionStatusFor } from './pif-billing';

// Dunning schedule: 1st retry after 1 day, 2nd after 3 days, 3rd after 7 days. If the charge
// still fails after the 3rd retry (4 consecutive failures total), we stop retrying and expire
// the workspace's subscription (enforced read-only by SubscriptionReadOnlyGuard).
const RETRY_DELAYS_DAYS = [1, 3, 7];

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private monnify: MonnifyService,
    private audit: AuditLogService,
  ) {}

  // ─── PIF's own subscription (spec §5.10 #17) ──────────────────────────────

  /** Settings → "Your Paid In Full subscription": tier, amount, next due, paid-up-to, NUBAN, history. */
  async getPifSubscription(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        name: true,
        status: true,
        tier: true,
        planTier: true,
        monthlyAmount: true,
        billingDay: true,
        paidUntil: true,
        nextDueDate: true,
        trialEndDate: true,
        billingAccountNumber: true,
        billingAccountName: true,
        billingAccountBank: true,
        subscription: { select: { payments: { orderBy: { paidAt: 'desc' }, take: 50 } } },
      },
    });
    if (!ws) throw new NotFoundException('Workspace not found');
    const due = pifDueInfo(ws);
    return {
      tier: ws.tier ?? ws.planTier,
      monthlyAmount: ws.monthlyAmount == null ? null : Number(ws.monthlyAmount),
      status: ws.status,
      paused: ws.status === WorkspaceStatus.PAUSED,
      nextDueDate: due.nextDue,
      paidUntil: ws.paidUntil,
      trialEndDate: ws.trialEndDate,
      overdue: due.overdue,
      daysOverdue: due.daysOverdue,
      graceEndsAt: due.graceEndsAt,
      billingDay: ws.billingDay ?? 25,
      rule: `Pay by the ${ordinal(ws.billingDay ?? 25)} for the next month. Paused if not paid within ${PIF_GRACE_DAYS} days of the due date.`,
      billingAccount: ws.billingAccountNumber
        ? { accountNumber: ws.billingAccountNumber, accountName: ws.billingAccountName, bankName: ws.billingAccountBank }
        : null,
      payments: (ws.subscription?.payments ?? []).map((p) => ({ id: p.id, amount: Number(p.amount), reference: p.monnifyReference, paidAt: p.paidAt })),
    };
  }

  /**
   * Creates the dedicated billing NUBAN (Monnify reserved account, reference `pifbill-<workspaceId>`).
   * BVN/NIN is passed through to Monnify (required for reserved accounts on live contracts).
   * Incoming transfers to this NUBAN should call recordPifPayment() (not wired to the Monnify webhook yet).
   */
  async provisionPifBillingAccount(workspaceId: string, actorId: string, kyc: { bvn?: string; nin?: string }) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, billingAccountNumber: true } });
    if (!ws) throw new NotFoundException('Workspace not found');
    if (ws.billingAccountNumber) return this.getPifSubscription(workspaceId);
    if (!kyc.bvn && !kyc.nin) throw new BadRequestException('Enter a BVN or NIN to create your billing account.');
    const accountName = `PIF - ${ws.name}`.slice(0, 60);
    const owner = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, role: 'ADMIN', isActive: true },
      orderBy: { invitedAt: 'asc' },
      include: { user: { select: { email: true } } },
    });
    const acct = await this.monnify.createReservedAccount({
      accountReference: `pifbill-${workspaceId}`,
      accountName,
      customerName: ws.name,
      customerEmail: owner?.user.email ?? `billing-${workspaceId}@paidinfull.app`,
      bvn: kyc.bvn,
      nin: kyc.nin,
    });
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        billingAccountNumber: acct.accountNumber,
        billingAccountName: acct.accountName ?? accountName,
        billingAccountBank: acct.bankName,
        billingAccountRef: acct.accountReference,
      },
    });
    await this.audit.record(workspaceId, actorId, 'billing.account_provisioned', acct.accountNumber, { bank: acct.bankName, kyc: kyc.bvn ? 'BVN' : 'NIN' });
    return this.getPifSubscription(workspaceId);
  }

  /**
   * Records a PIF fee payment (manual by super admin, or from a billing-NUBAN collection webhook).
   * Extends paid-until by the number of whole months the amount covers (min 1) and un-pauses.
   * Idempotent on `reference`.
   */
  async recordPifPayment(workspaceId: string, amount: number, reference: string, paidAt = new Date(), actorId?: string | null) {
    if (!(amount > 0)) throw new BadRequestException('Amount must be greater than 0.');
    const existing = await this.prisma.billingPayment.findUnique({ where: { monnifyReference: reference } });
    if (existing) return this.getPifSubscription(workspaceId);

    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, include: { subscription: true } });
    if (!ws) throw new NotFoundException('Workspace not found');

    let subscriptionId = ws.subscription?.id;
    if (!subscriptionId) {
      const plan =
        (await this.prisma.billingPlan.findUnique({ where: { tier: ws.planTier } })) ??
        (await this.prisma.billingPlan.create({
          data: { tier: ws.planTier, name: ws.planTier, priceMonthly: ws.monthlyAmount ?? amount, features: {} },
        }));
      const sub = await this.prisma.workspaceSubscription.create({
        data: { workspaceId, billingPlanId: plan.id, currentPeriodStart: paidAt, currentPeriodEnd: ws.paidUntil ?? paidAt },
      });
      subscriptionId = sub.id;
    }

    const plan = ws.subscription
      ? await this.prisma.billingPlan.findUnique({ where: { id: ws.subscription.billingPlanId } })
      : null;
    const { months, coversSetup } = pifPaymentCoverage({
      amount,
      plan: plan
        ? { monthly: Number(plan.priceMonthly), setupFee: Number(plan.setupFee ?? 0), prepayMonths: plan.prepayMonths ?? 0, prepayMonthly: Number(plan.prepayMonthlyAmount ?? 0) }
        : null,
      setupFeePaid: !!ws.subscription?.setupFeePaidAt,
      fallbackMonthly: ws.monthlyAmount ? Number(ws.monthlyAmount) : amount,
    });
    const base = ws.paidUntil && ws.paidUntil > paidAt ? ws.paidUntil : paidAt;
    const paidUntil = addMonths(base, months);
    const status = ws.status === WorkspaceStatus.PAUSED || ws.status === WorkspaceStatus.TRIAL || ws.status === WorkspaceStatus.LEAD ? WorkspaceStatus.ACTIVE : ws.status;

    await this.prisma.$transaction([
      this.prisma.billingPayment.create({ data: { workspaceSubscriptionId: subscriptionId, amount, monnifyReference: reference, paidAt } }),
      this.prisma.workspaceSubscription.update({ where: { id: subscriptionId }, data: { currentPeriodEnd: paidUntil, ...(coversSetup && { setupFeePaidAt: paidAt }) } }),
      this.prisma.workspace.update({
        where: { id: workspaceId },
        data: { paidUntil, nextDueDate: paidUntil, status, subscriptionStatus: subscriptionStatusFor(status) },
      }),
    ]);
    await this.audit.record(workspaceId, actorId ?? null, 'billing.payment_recorded', reference, { amount, months, paidUntil });
    return this.getPifSubscription(workspaceId);
  }

  /** Daily: pause clients not paid within 7 days of their due date. */
  @Cron('0 6 * * *')
  async pauseOverdueWorkspaces() {
    const candidates = await this.prisma.workspace.findMany({
      where: { status: { in: [WorkspaceStatus.ACTIVE, WorkspaceStatus.TRIAL] }, isGrandfathered: false },
      select: { id: true, name: true, status: true, paidUntil: true, nextDueDate: true, trialEndDate: true, billingDay: true },
    });
    let paused = 0;
    for (const ws of candidates) {
      const due = pifDueInfo(ws);
      if (!due.shouldPause) continue;
      await this.prisma.workspace.update({
        where: { id: ws.id },
        data: { status: WorkspaceStatus.PAUSED, subscriptionStatus: subscriptionStatusFor(WorkspaceStatus.PAUSED) },
      });
      await this.audit.record(ws.id, null, 'billing.workspace_paused', ws.name, { nextDueDate: due.nextDue, daysOverdue: due.daysOverdue });
      paused += 1;
    }
    if (paused) this.logger.warn(`Paused ${paused} workspace(s) unpaid ${PIF_GRACE_DAYS}+ days past due`);
    return { paused };
  }

  // ─── Subscription read/upgrade ────────────────────────────────────────────

  async getSubscription(workspaceId: string) {
    const subscription = await this.prisma.workspaceSubscription.findUnique({
      where: { workspaceId },
      include: { billingPlan: true, dunningState: true },
    });
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { planTier: true, subscriptionStatus: true, trialEndDate: true, isGrandfathered: true },
    });
    return { subscription, workspace };
  }

  async upgrade(workspaceId: string, dto: UpgradeSubscriptionDto) {
    const plan = await this.prisma.billingPlan.findUnique({ where: { tier: dto.planTier } });
    if (!plan) {
      throw new NotFoundException(`No billing plan configured for tier ${dto.planTier} — create it via POST /billing/plans first`);
    }

    const now = new Date();
    const periodEnd = addMonths(now, 1);

    const [subscription] = await this.prisma.$transaction([
      this.prisma.workspaceSubscription.upsert({
        where: { workspaceId },
        create: {
          workspaceId,
          billingPlanId: plan.id,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
        update: {
          billingPlanId: plan.id,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
        include: { billingPlan: true },
      }),
      this.prisma.workspace.update({
        where: { id: workspaceId },
        data: { planTier: dto.planTier, subscriptionStatus: SubscriptionStatus.ACTIVE },
      }),
    ]);

    return subscription;
  }

  // ─── Charging ──────────────────────────────────────────────────────────────

  async chargeSubscription(workspaceId: string, dto: ChargeSubscriptionDto) {
    return runIdempotent(this.prisma, workspaceId, 'billing.charge_subscription', dto.clientRequestId, async (tx) => {
      const subscription = await tx.workspaceSubscription.findUnique({
        where: { workspaceId },
        include: { billingPlan: true },
      });
      if (!subscription) {
        throw new NotFoundException('Workspace has no active subscription to charge');
      }

      const workspace = await tx.workspace.findUnique({ where: { id: workspaceId } });
      const owner = await tx.workspaceMember.findFirst({
        where: { workspaceId },
        include: { user: true },
        orderBy: { invitedAt: 'asc' },
      });

      const reference = `sub_${subscription.id}_${Date.now()}`;
      const result = await this.chargeCard({
        amount: Number(subscription.billingPlan.priceMonthly),
        reference,
        customerEmail: owner?.user.email ?? 'billing@paidinfull.app',
        customerName: workspace?.name ?? 'Workspace',
        workspaceSubscriptionId: subscription.id,
        cardToken: dto.cardToken,
      });

      return { initiated: result.initiated, monnifyReference: result.monnifyReference };
    });
  }

  /**
   * BEST-EFFORT / UNCONFIRMED: builds a minimal Monnify card-charge call directly with `fetch`,
   * self-contained (no import from the sibling `monnify` module). Assumptions, none confirmed
   * against live Monnify docs in this session:
   *  - Auth: POST {baseUrl}/api/v1/auth/login with `Authorization: Basic base64(apiKey:secretKey)`
   *    returns `{ responseBody: { accessToken, expiresIn } }`; that accessToken is then sent as
   *    `Authorization: Bearer <token>` on subsequent calls (Monnify's documented pattern for its
   *    other endpoints — assumed to also apply here).
   *  - Recurring/unattended charge: if a `cardToken` (from a prior card-tokenization consent flow)
   *    is available, POST {baseUrl}/api/v1/merchant/cards/charge-token with
   *    { cardToken, amount, paymentReference, customerEmail, customerName, contractCode } —
   *    endpoint path and body shape GUESSED, not confirmed to exist.
   *  - No `cardToken` on file: falls back to POST {baseUrl}/api/v1/merchant/transactions/init-transaction
   *    (Monnify's documented "Initialize Transaction" hosted-checkout endpoint) with
   *    { amount, customerName, customerEmail, paymentReference, paymentDescription,
   *      currencyCode: 'NGN', contractCode, paymentMethods: ['CARD'] }, returning a `checkoutUrl`.
   *    This variant cannot complete unattended (no card entry UI in a cron job) — it only ever
   *    fires from the interactive POST /billing/subscription/charge endpoint, never from the cron.
   * Whichever endpoint is right, the actual charge result always arrives asynchronously via
   * POST /billing/webhook, which is where BillingPayment/dunning state actually gets written.
   */
  private async chargeCard(params: {
    amount: number;
    reference: string;
    customerEmail: string;
    customerName: string;
    workspaceSubscriptionId: string;
    cardToken?: string;
  }): Promise<{ initiated: boolean; monnifyReference: string }> {
    const config = this.configService.get('monnify') as {
      baseUrl: string;
      apiKey?: string;
      secretKey?: string;
      contractCode?: string;
      mockMode: boolean;
    };

    if (config.mockMode) {
      this.logger.log(`[mock] Simulating Monnify card charge for ${params.reference} (₦${params.amount})`);
      setTimeout(() => {
        this.handleWebhook({
          eventType: 'SUCCESSFUL_TRANSACTION',
          eventData: {
            transactionReference: params.reference,
            paymentReference: params.reference,
            amountPaid: params.amount,
            paidOn: new Date().toISOString(),
            paymentStatus: 'PAID',
            metaData: { workspaceSubscriptionId: params.workspaceSubscriptionId },
          },
        }).catch((err) => this.logger.error('Mock webhook self-call failed', err));
      }, 1500);
      return { initiated: true, monnifyReference: params.reference };
    }

    try {
      const accessToken = await this.getAccessToken(config);
      const endpoint = params.cardToken
        ? `${config.baseUrl}/api/v1/merchant/cards/charge-token`
        : `${config.baseUrl}/api/v1/merchant/transactions/init-transaction`;

      const body = params.cardToken
        ? {
            cardToken: params.cardToken,
            amount: params.amount,
            paymentReference: params.reference,
            customerEmail: params.customerEmail,
            customerName: params.customerName,
            contractCode: config.contractCode,
          }
        : {
            amount: params.amount,
            customerName: params.customerName,
            customerEmail: params.customerEmail,
            paymentReference: params.reference,
            paymentDescription: 'Paid in Full subscription renewal',
            currencyCode: 'NGN',
            contractCode: config.contractCode,
            paymentMethods: ['CARD'],
          };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok || data?.requestSuccessful === false) {
        throw new BadRequestException(data?.responseMessage || 'Monnify charge initialization failed');
      }

      return { initiated: true, monnifyReference: params.reference };
    } catch (error) {
      this.logger.error(`Monnify charge call failed for ${params.reference}`, error as Error);
      return { initiated: false, monnifyReference: params.reference };
    }
  }

  private tokenCache: { token: string; expiresAt: number } | null = null;

  private async getAccessToken(config: { baseUrl: string; apiKey?: string; secretKey?: string }): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }
    const basic = Buffer.from(`${config.apiKey}:${config.secretKey}`).toString('base64');
    const response = await fetch(`${config.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    if (!response.ok || !data?.responseBody?.accessToken) {
      throw new BadRequestException('Failed to authenticate with Monnify');
    }
    const token = data.responseBody.accessToken as string;
    const expiresInSec = Number(data.responseBody.expiresIn ?? 3300);
    this.tokenCache = { token, expiresAt: Date.now() + (expiresInSec - 60) * 1000 };
    return token;
  }

  // ─── Webhook ───────────────────────────────────────────────────────────────

  async handleWebhook(dto: MonnifyWebhookDto) {
    const reference = dto.eventData?.paymentReference || dto.eventData?.transactionReference;
    const workspaceSubscriptionId = dto.eventData?.metaData?.workspaceSubscriptionId as string | undefined;

    if (!reference || !workspaceSubscriptionId) {
      this.logger.warn('Ignoring Monnify billing webhook with no workspaceSubscriptionId in metaData', dto);
      return { received: true };
    }

    const succeeded = dto.eventType?.includes('SUCCESSFUL') || dto.eventData?.paymentStatus === 'PAID';

    const subscription = await this.prisma.workspaceSubscription.findUnique({
      where: { id: workspaceSubscriptionId },
      include: { billingPlan: true },
    });
    if (!subscription) {
      this.logger.warn(`Webhook for unknown workspaceSubscriptionId=${workspaceSubscriptionId}`);
      return { received: true };
    }

    if (succeeded) {
      await this.recordChargeSuccess(subscription.id, subscription.workspaceId, Number(subscription.billingPlan.priceMonthly), reference, subscription.currentPeriodEnd);
    } else {
      await this.recordChargeFailure(subscription.id, subscription.workspaceId, Number(subscription.billingPlan.priceMonthly), dto.eventData?.paymentStatus || 'FAILED');
    }

    return { received: true };
  }

  private async recordChargeSuccess(
    workspaceSubscriptionId: string,
    workspaceId: string,
    amount: number,
    monnifyReference: string,
    currentPeriodEnd: Date,
  ) {
    const now = new Date();
    const newPeriodEnd = addMonths(currentPeriodEnd > now ? currentPeriodEnd : now, 1);

    await this.prisma.$transaction([
      this.prisma.billingPayment.create({
        data: { workspaceSubscriptionId, amount, monnifyReference },
      }),
      this.prisma.subscriptionChargeAttempt.create({
        data: { workspaceSubscriptionId, amount, succeeded: true },
      }),
      this.prisma.workspaceSubscription.update({
        where: { id: workspaceSubscriptionId },
        data: { currentPeriodStart: now, currentPeriodEnd: newPeriodEnd },
      }),
      this.prisma.subscriptionDunningState.upsert({
        where: { workspaceSubscriptionId },
        create: { workspaceSubscriptionId, consecutiveFailures: 0, nextRetryAt: null, suspendedAt: null },
        update: { consecutiveFailures: 0, nextRetryAt: null, suspendedAt: null },
      }),
      this.prisma.workspace.update({
        where: { id: workspaceId },
        data: { subscriptionStatus: SubscriptionStatus.ACTIVE },
      }),
    ]);

    this.logger.log(`Subscription ${workspaceSubscriptionId} renewed via ${monnifyReference}`);
  }

  private async recordChargeFailure(workspaceSubscriptionId: string, workspaceId: string, amount: number, reason: string) {
    const existingDunning = await this.prisma.subscriptionDunningState.findUnique({ where: { workspaceSubscriptionId } });
    const newConsecutiveFailures = (existingDunning?.consecutiveFailures ?? 0) + 1;
    const now = new Date();
    const retryDelay = RETRY_DELAYS_DAYS[newConsecutiveFailures - 1];
    const nextRetryAt = retryDelay ? addDays(now, retryDelay) : null;

    let status: SubscriptionStatus | undefined;
    if (newConsecutiveFailures >= 4) {
      status = SubscriptionStatus.EXPIRED;
    } else if (newConsecutiveFailures === 3) {
      status = SubscriptionStatus.PAST_DUE;
    }

    await this.prisma.$transaction([
      this.prisma.subscriptionChargeAttempt.create({
        data: { workspaceSubscriptionId, amount, succeeded: false, failureReason: reason },
      }),
      this.prisma.subscriptionDunningState.upsert({
        where: { workspaceSubscriptionId },
        create: {
          workspaceSubscriptionId,
          consecutiveFailures: newConsecutiveFailures,
          nextRetryAt,
          suspendedAt: newConsecutiveFailures >= 4 ? now : null,
        },
        update: {
          consecutiveFailures: newConsecutiveFailures,
          nextRetryAt,
          suspendedAt: newConsecutiveFailures >= 4 ? now : null,
        },
      }),
      ...(status
        ? [this.prisma.workspace.update({ where: { id: workspaceId }, data: { subscriptionStatus: status } })]
        : []),
    ]);

    this.logger.warn(
      `Subscription ${workspaceSubscriptionId} charge failed (attempt #${newConsecutiveFailures}): ${reason}${status ? ` — workspace status -> ${status}` : ''}`,
    );
  }

  // ─── Cron: daily due-charge + dunning retry sweep ───────────────────────────

  @Cron('0 7 * * *')
  async runDailyBillingSweep() {
    // Off unless explicitly enabled: card auto-charge is best-effort/unconfirmed here, and the production
    // product collects subscriptions by bank transfer (Lovable never attempted a card charge). Enabling
    // it on the imported customers would start charging/dunning real workspaces.
    if (process.env.BILLING_AUTO_CHARGE !== 'true') return;
    const now = new Date();
    this.logger.log('Running daily subscription billing sweep');

    const due = await this.prisma.workspaceSubscription.findMany({
      where: {
        currentPeriodEnd: { lte: now },
        workspace: { subscriptionStatus: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } },
      },
      include: { billingPlan: true, workspace: true },
    });

    for (const sub of due) {
      await this.fireCronCharge(sub.id, sub.workspaceId, `cron-due-${sub.id}-${now.toISOString().slice(0, 10)}`);
    }

    const retries = await this.prisma.subscriptionDunningState.findMany({
      where: { nextRetryAt: { lte: now } },
      include: { workspaceSubscription: true },
    });

    for (const dunning of retries) {
      await this.fireCronCharge(
        dunning.workspaceSubscriptionId,
        dunning.workspaceSubscription.workspaceId,
        `cron-retry-${dunning.workspaceSubscriptionId}-${now.toISOString().slice(0, 10)}`,
      );
    }

    this.logger.log(`Billing sweep complete — ${due.length} due, ${retries.length} retries fired`);
  }

  private async fireCronCharge(workspaceSubscriptionId: string, workspaceId: string, idempotencyKey: string) {
    try {
      await this.chargeSubscription(workspaceId, { clientRequestId: idempotencyKey });
    } catch (error) {
      this.logger.error(`Cron charge failed for subscription ${workspaceSubscriptionId}`, error as Error);
    }
  }
}
