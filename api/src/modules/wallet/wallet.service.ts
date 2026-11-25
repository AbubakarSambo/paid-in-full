import { BadRequestException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { LedgerDirection, LedgerStatus, Prisma, TopupSource, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, AuditActor } from '../platform/audit-log.service';
import { AUDIT_ACTIONS, paginate, PaginationDto, runIdempotent } from '../../common';
import { MonnifyService } from '../monnify/monnify.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LinkReservedAccountDto, ProvisionReservedAccountDto, RenameReservedAccountDto, TopUpDto, WalletLedgerQueryDto } from './dto';
import { lineSafety, outstandingOf, round2, toNum } from './payout-math';

type Db = Prisma.TransactionClient | PrismaService;

export interface WalletBalance {
  workspaceId: string;
  /** Spec §8: confirmed credits − (completed + in-flight debits). */
  balance: number;
  /** What a disbursement can use right now (= balance, never below 0). */
  readyToSend: number;
  /** Credits seen but not yet confirmed. */
  clearing: number;
  confirmedCredits: number;
  completedDebits: number;
  inFlightDebits: number;
}

export interface RecordTopupParams {
  reference: string;
  amount: number;
  payerName?: string | null;
  payerBank?: string | null;
  payerAccountNumber?: string | null;
  paidAt?: Date | null;
  source: TopupSource;
}

/** Postgres advisory lock that serialises every wallet mutation of one workspace. */
export async function lockWallet(tx: Prisma.TransactionClient, workspaceId: string) {
  await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${`wallet:${workspaceId}`}))`;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    @Inject(forwardRef(() => MonnifyService))
    private readonly monnifyService: MonnifyService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Balance ──────────────────────────────────────────────────────────────

  async computeBalance(db: Db, workspaceId: string): Promise<WalletBalance> {
    const groups = await db.walletLedgerEntry.groupBy({
      by: ['direction', 'status'],
      where: { workspaceId },
      _sum: { amount: true },
    });
    const sum = (direction: LedgerDirection, status: LedgerStatus) =>
      Math.abs(toNum(groups.find((g) => g.direction === direction && g.status === status)?._sum.amount));
    const confirmedCredits = round2(sum('IN', 'COMPLETED'));
    const clearing = round2(sum('IN', 'PENDING'));
    const completedDebits = round2(sum('OUT', 'COMPLETED'));
    const inFlightDebits = round2(sum('OUT', 'PENDING'));
    const balance = round2(confirmedCredits - completedDebits - inFlightDebits);
    return {
      workspaceId,
      balance,
      readyToSend: Math.max(0, balance),
      clearing,
      confirmedCredits,
      completedDebits,
      inFlightDebits,
    };
  }

  getBalance(workspaceId: string) {
    return this.computeBalance(this.prisma, workspaceId);
  }

  /** Wallet Health card + header pill (spec §5.10.15). */
  async getSummary(workspaceId: string) {
    const [balance, workspace, inflows] = await Promise.all([
      this.computeBalance(this.prisma, workspaceId),
      this.prisma.workspace.findUnique({ where: { id: workspaceId } }),
      this.prisma.walletLedgerEntry.aggregate({
        where: { workspaceId, direction: 'IN', status: 'COMPLETED', postedAt: { gte: new Date(Date.now() - 86_400_000) } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    // Money needed to clear everything currently payable in open batches.
    const items = await this.prisma.batchItem.findMany({
      where: { batch: { workspaceId, payoutStatus: { not: 'CANCELLED' } }, payoutStatus: { notIn: ['CANCELLED', 'SUCCESS'] } },
      include: { payouts: true },
    });
    const needed = round2(
      items.filter((i) => lineSafety(i).selectable).reduce((s, i) => s + outstandingOf(i.total, i.paidAmount), 0),
    );

    let status: 'HEALTHY' | 'ATTENTION' | 'ACTION_NEEDED';
    let message: string;
    if (balance.balance < 0) {
      status = 'ACTION_NEEDED';
      message = 'Ledger shows more going out than came in — reconcile top-ups now.';
    } else if (needed <= balance.readyToSend) {
      status = 'HEALTHY';
      message = needed > 0 ? 'Enough to pay every open batch.' : 'Nothing waiting to be paid.';
    } else if (balance.readyToSend >= needed * 0.5) {
      status = 'ATTENTION';
      message = `₦${round2(needed - balance.readyToSend).toLocaleString()} short of paying every open batch.`;
    } else {
      status = 'ACTION_NEEDED';
      message = `Top up: ₦${round2(needed - balance.readyToSend).toLocaleString()} short of paying every open batch.`;
    }

    return {
      ...balance,
      health: { status, label: { HEALTHY: 'Healthy', ATTENTION: 'Attention', ACTION_NEEDED: 'Action needed' }[status], message, needed },
      inflows24h: { amount: round2(toNum(inflows._sum.amount)), count: inflows._count },
      account: this.accountOf(workspace),
      mockMode: this.monnifyService.mockMode,
    };
  }

  private accountOf(workspace: { monnifyReservedAccountNumber: string | null; monnifyReservedAccountName: string | null; monnifyReservedAccountBank: string | null; monnifyReservedAccountRef: string | null; monnifyContractCode: string | null } | null) {
    if (!workspace?.monnifyReservedAccountNumber) return null;
    return {
      accountNumber: workspace.monnifyReservedAccountNumber,
      accountName: workspace.monnifyReservedAccountName,
      bankName: workspace.monnifyReservedAccountBank,
      accountReference: workspace.monnifyReservedAccountRef,
      contractCode: workspace.monnifyContractCode,
    };
  }

  async listLedger(workspaceId: string, filter: WalletLedgerQueryDto) {
    const { page = 1, limit = 20, type, direction, status, startDate, endDate } = filter;
    const where: Prisma.WalletLedgerEntryWhereInput = {
      workspaceId,
      ...(type && { type }),
      ...(direction && { direction }),
      ...(status && { status }),
      ...((startDate || endDate) && {
        postedAt: { ...(startDate && { gte: startDate }), ...(endDate && { lte: endDate }) },
      }),
    };
    const [entries, total] = await Promise.all([
      this.prisma.walletLedgerEntry.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { postedAt: 'desc' },
        include: { batch: { select: { batchRef: true } } },
      }),
      this.prisma.walletLedgerEntry.count({ where }),
    ]);
    const actorIds = [...new Set(entries.map((e) => e.actorUserId).filter((x): x is string => !!x))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true, firstName: true, lastName: true, email: true } })
      : [];
    const nameOf = new Map(actors.map((a) => [a.id, a.displayName || `${a.firstName} ${a.lastName}`.trim() || a.email]));
    return paginate(
      entries.map((e) => ({ ...e, actorName: e.actorUserId ? nameOf.get(e.actorUserId) ?? null : null })),
      total,
      page,
      limit,
    );
  }

  /** Top-Up History (spec §5.10.16): When, Payer, Reference, Amount, Source. */
  async listTopups(workspaceId: string, pagination: PaginationDto) {
    const { page = 1, limit = 20 } = pagination;
    const where: Prisma.WalletTopupWhereInput = { workspaceId, status: 'SUCCESS' };
    const [rows, total] = await Promise.all([
      this.prisma.walletTopup.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }] }),
      this.prisma.walletTopup.count({ where }),
    ]);
    return paginate(rows, total, page, limit);
  }

  // ─── Ledger writes ────────────────────────────────────────────────────────

  /**
   * The only writer of WalletLedgerEntry rows. Caller must hold lockWallet() in `tx` so the
   * balanceBefore/After snapshot is consistent. `amount` is unsigned; direction sets the sign.
   */
  async postEntry(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    entry: {
      direction: LedgerDirection;
      status: LedgerStatus;
      amount: number;
      type: WalletTransactionType;
      reference?: string | null;
      sourceType?: string;
      sourceId?: string;
      batchId?: string | null;
      description?: string;
      actorUserId?: string | null;
    },
  ) {
    const before = (await this.computeBalance(tx, workspaceId)).balance;
    const signed = entry.direction === 'IN' ? Math.abs(entry.amount) : -Math.abs(entry.amount);
    const counts = (entry.direction === 'IN' && entry.status === 'COMPLETED') || (entry.direction === 'OUT' && entry.status !== 'FAILED' && entry.status !== 'REVERSED');
    return tx.walletLedgerEntry.create({
      data: {
        workspaceId,
        type: entry.type,
        direction: entry.direction,
        status: entry.status,
        amount: round2(signed),
        balanceBefore: before,
        balanceAfter: counts ? round2(before + signed) : before,
        reference: entry.reference ?? undefined,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        batchId: entry.batchId ?? undefined,
        description: entry.description,
        actorUserId: entry.actorUserId ?? undefined,
      },
    });
  }

  /**
   * Records a confirmed credit into the workspace wallet (webhook, reconciliation, card top-up).
   * Idempotent on `reference`: a duplicate webhook or a re-run of "Reconcile top-ups" is a no-op.
   */
  async recordTopup(workspaceId: string, params: RecordTopupParams): Promise<{ created: boolean; topupId: string }> {
    if (!params.reference || !(params.amount > 0)) throw new BadRequestException('Top-up needs a reference and a positive amount');
    const result: { created: boolean; topupId: string; funded?: { batchId: string; requiredAmount: number }[] } = await this.prisma.$transaction(async (tx) => {
      await lockWallet(tx, workspaceId);
      const existing = await tx.walletTopup.findUnique({ where: { reference: params.reference } });
      if (existing && existing.workspaceId !== workspaceId) {
        this.logger.error(`Top-up reference ${params.reference} belongs to another workspace — ignored`);
        return { created: false, topupId: existing.id };
      }
      if (existing?.status === 'SUCCESS') return { created: false, topupId: existing.id };

      const paidAt = params.paidAt ?? new Date();
      const topup = existing
        ? await tx.walletTopup.update({
            where: { id: existing.id },
            data: {
              status: 'SUCCESS',
              amount: params.amount,
              paidAt,
              completedAt: new Date(),
              payerName: params.payerName ?? existing.payerName,
              payerBank: params.payerBank ?? existing.payerBank,
              payerAccountNumber: params.payerAccountNumber ?? existing.payerAccountNumber,
            },
          })
        : await tx.walletTopup.create({
            data: {
              workspaceId,
              amount: params.amount,
              reference: params.reference,
              payerName: params.payerName,
              payerBank: params.payerBank,
              payerAccountNumber: params.payerAccountNumber,
              source: params.source,
              status: 'SUCCESS',
              paidAt,
              completedAt: new Date(),
            },
          });

      await this.postEntry(tx, workspaceId, {
        direction: 'IN',
        status: 'COMPLETED',
        amount: params.amount,
        type: 'TOPUP',
        reference: params.reference,
        sourceType: 'topup',
        sourceId: topup.id,
        description: `Top-up${params.payerName ? ` from ${params.payerName}` : ''}${params.source === 'MANUAL_RECONCILIATION' ? ' (reconciled)' : ''}`,
      });

      // Funding waits (spec: batches that were short) are resolved once the wallet covers them.
      const balance = (await this.computeBalance(tx, workspaceId)).readyToSend;
      const funded = await this.fundWaits(tx, workspaceId, balance);
      return { created: true, topupId: topup.id, funded };
    });
    if (result.created && result.funded?.length) await this.notifyFunded(workspaceId, result.funded);

    if (result.created) {
      await this.audit.record(workspaceId, null, AUDIT_ACTIONS.WALLET_TOPUP_RECEIVED, params.reference, {
        amount: params.amount,
        payerName: params.payerName,
        source: params.source,
      });
    }
    return result;
  }

  /** Lists recent transactions on the reserved account and records any we don't have. Idempotent on the Monnify reference. */
  async syncTopups(workspaceId: string, accountReference: string) {
    const txs = await this.monnifyService.listReservedAccountTransactions(accountReference);
    let added = 0;
    let addedAmount = 0;
    for (const t of txs) {
      if (t.status !== 'PAID' || !(t.amount > 0)) continue;
      const res = await this.recordTopup(workspaceId, {
        reference: t.reference,
        amount: t.amount,
        payerName: t.payerName,
        payerBank: t.payerBank,
        payerAccountNumber: t.payerAccountNumber,
        paidAt: t.paidAt,
        source: 'MANUAL_RECONCILIATION',
      });
      if (res.created) {
        added++;
        addedAmount = round2(addedAmount + t.amount);
      }
    }
    return { checked: txs.length, added, addedAmount };
  }

  private pollingTopups = false;

  /**
   * Every five minutes (Lovable: monnify-poll): replays reserved-account inflows whose webhook never
   * arrived. Skipped in mock mode, where the listing is synthetic and would credit fake money.
   */
  async pollAllTopups() {
    if (this.monnifyService.mockMode || this.pollingTopups) return { skipped: true as const };
    this.pollingTopups = true;
    const tally = { workspaces: 0, checked: 0, added: 0, addedAmount: 0, errors: 0, skipped: false as const };
    try {
      const workspaces = await this.prisma.workspace.findMany({
        where: { monnifyReservedAccountRef: { not: null }, status: { not: 'DEAD' } },
        select: { id: true, monnifyReservedAccountRef: true, monnifyReservedAccountNumber: true },
      });
      for (const w of workspaces) {
        try {
          const r = await this.syncTopups(w.id, w.monnifyReservedAccountRef!);
          tally.workspaces++;
          tally.checked += r.checked;
          tally.added += r.added;
          tally.addedAmount = round2(tally.addedAmount + r.addedAmount);
          if (r.added > 0) {
            await this.audit.record(w.id, null, AUDIT_ACTIONS.WALLET_TOPUPS_RECONCILED, w.monnifyReservedAccountNumber, { ...r, source: 'monnify-poll' });
          }
        } catch (error) {
          tally.errors++;
          this.logger.warn(`Top-up poll failed for workspace ${w.id}: ${(error as Error).message}`);
        }
      }
      if (tally.added || tally.errors) this.logger.log(`Top-up poll: ${JSON.stringify(tally)}`);
    } finally {
      this.pollingTopups = false;
    }
    return tally;
  }

  /** Marks WAITING shortfalls FUNDED once the wallet covers them; returns the ones just resolved. */
  private async fundWaits(db: Db, workspaceId: string, readyToSend: number) {
    const waits = await db.payoutFundingWait.findMany({ where: { workspaceId, status: 'WAITING' }, orderBy: { createdAt: 'asc' } });
    const funded: { batchId: string; requiredAmount: number }[] = [];
    for (const wait of waits) {
      if (readyToSend >= toNum(wait.requiredAmount)) {
        await db.payoutFundingWait.update({
          where: { id: wait.id },
          data: { status: 'FUNDED', availableAmount: readyToSend, resolvedAt: new Date(), notifiedAt: new Date() },
        });
        funded.push({ batchId: wait.batchId, requiredAmount: toNum(wait.requiredAmount) });
      }
    }
    return funded;
  }

  private async notifyFunded(workspaceId: string, funded: { batchId: string; requiredAmount: number }[]) {
    const batches = await this.prisma.batch.findMany({ where: { id: { in: funded.map((f) => f.batchId) } }, select: { id: true, batchRef: true } });
    const ref = new Map(batches.map((b) => [b.id, b.batchRef]));
    for (const f of funded) {
      await this.notifications
        .notify(workspaceId, 'disbursement_result', {
          title: `${ref.get(f.batchId) ?? 'Batch'}: wallet funded — ready to pay`,
          body: `Your wallet now covers this batch (₦${f.requiredAmount.toLocaleString('en-NG')}). Open Batches to disburse.`,
          url: `/app?tab=batches&batch=${f.batchId}`,
        })
        .catch((e) => this.logger.warn(`Funding notification failed: ${(e as Error).message}`));
    }
  }

  private sweeping = false;

  /**
   * Funding watcher (port of Lovable's monnify-sweep; every 10 minutes). It moves no money. Per workspace it:
   *  1. compares the ledger's available balance with the live Monnify wallet balance
   *     (ready to pay = min of the two; clearing = ledger money Monnify has not released yet),
   *  2. records the check in wallet_sweeps when anything changed (Lovable wrote a row every run; this keeps
   *     the same history without 144 identical rows a day), `releasedAmount` being how much the live wallet
   *     grew since the previous check,
   *  3. marks WAITING shortfalls FUNDED once ready-to-pay covers them, and tells the team.
   * An unreachable Monnify is recorded as "blocked" and never treated as a zero balance.
   */
  async runSweep() {
    if (this.sweeping) return { skipped: true as const };
    this.sweeping = true;
    try {
      const [wallets, waits] = await Promise.all([
        this.prisma.workspace.findMany({ where: { monnifyReservedAccountNumber: { not: null } }, select: { id: true } }),
        this.prisma.payoutFundingWait.findMany({ where: { status: 'WAITING' }, select: { workspaceId: true }, distinct: ['workspaceId'] }),
      ]);
      const ids = new Set([...wallets.map((w) => w.id), ...waits.map((w) => w.workspaceId)]);
      const live = await this.monnifyService.getWalletBalance(); // one shared Monnify wallet, one call per run
      const results: Array<{ workspaceId: string; status: string; readyToPay: number; clearing: number; released: number; notified: number }> = [];
      for (const workspaceId of ids) {
        try {
          results.push(await this.sweepWorkspace(workspaceId, live));
        } catch (error) {
          this.logger.warn(`Sweep failed for workspace ${workspaceId}: ${(error as Error).message}`);
        }
      }
      return { skipped: false as const, workspaces: results.length, notified: results.reduce((s, r) => s + r.notified, 0), results };
    } finally {
      this.sweeping = false;
    }
  }

  async sweepWorkspace(workspaceId: string, live: { available: number | null; reason: string | null }) {
    const ledgerAvailable = (await this.computeBalance(this.prisma, workspaceId)).balance;
    const liveBalance = live.available;
    const readyToPay = liveBalance == null ? ledgerAvailable : Math.max(0, Math.min(ledgerAvailable, liveBalance));
    const clearing = liveBalance == null ? 0 : Math.max(0, round2(ledgerAvailable - liveBalance));
    const status = live.reason ? 'blocked' : clearing > 0 ? 'clearing' : 'ok';

    const prev = await this.prisma.walletSweep.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
    const prevLive = prev?.liveWalletBalance == null ? null : toNum(prev.liveWalletBalance);
    const released = liveBalance != null && prevLive != null ? Math.max(0, round2(liveBalance - prevLive)) : 0;
    const changed =
      !prev ||
      prev.status !== status ||
      (prev.reason ?? null) !== (live.reason ?? null) ||
      prevLive !== liveBalance ||
      round2(toNum(prev.ledgerAvailable)) !== round2(ledgerAvailable) ||
      round2(toNum(prev.clearing)) !== clearing;
    if (changed) {
      await this.prisma.walletSweep.create({
        data: {
          workspaceId,
          liveWalletBalance: liveBalance,
          ledgerAvailable,
          clearing,
          releasedAmount: released,
          amount: released,
          status,
          reason: live.reason,
          raw: { readyToPay },
        },
      });
    }

    const funded = await this.prisma.$transaction(async (tx) => {
      await lockWallet(tx, workspaceId);
      return this.fundWaits(tx, workspaceId, readyToPay);
    });
    if (funded.length) await this.notifyFunded(workspaceId, funded);
    return { workspaceId, status, readyToPay, clearing, released, notified: funded.length };
  }

  /**
   * "Reconcile top-ups": back-fills missed webhooks by listing recent transactions on the
   * reserved account and recording any we don't have. Idempotent on the Monnify reference.
   */
  async reconcileTopups(workspaceId: string, actor: AuditActor) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace?.monnifyReservedAccountRef) {
      throw new BadRequestException('No wallet account is linked to this workspace yet');
    }
    const { checked, added, addedAmount } = await this.syncTopups(workspaceId, workspace.monnifyReservedAccountRef);
    const txs = { length: checked };
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.WALLET_TOPUPS_RECONCILED, workspace.monnifyReservedAccountNumber, {
      checked: txs.length,
      added,
      addedAmount,
    });
    return {
      checked: txs.length,
      added,
      addedAmount,
      message:
        added === 0
          ? `Up to date — checked ${txs.length} recent transactions, nothing missing`
          : `Checked ${txs.length} recent transactions, added ${added} missing top-up${added === 1 ? '' : 's'}`,
    };
  }

  // ─── Reserved account (admin) ─────────────────────────────────────────────

  async provisionAccount(workspaceId: string, actor: AuditActor, dto: ProvisionReservedAccountDto) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.monnifyReservedAccountNumber) {
      throw new BadRequestException('A wallet account is already linked. Unlink it before provisioning a new one.');
    }
    if (!dto.bvn && !dto.nin) throw new BadRequestException('BVN or NIN is required to provision a reserved account');
    const accountName = dto.accountName?.trim() || workspace.name;
    const created = await this.monnifyService.createReservedAccount({
      accountReference: `PIF-${workspaceId}`,
      accountName,
      currencyCode: dto.currency ?? workspace.currency ?? 'NGN',
      contractCode: dto.contractCode ?? workspace.monnifyContractCode ?? undefined,
      customerName: dto.customerName ?? accountName,
      customerEmail: dto.customerEmail ?? `workspace-${workspaceId}@paidinfull.app`,
      bvn: dto.bvn,
      nin: dto.nin,
    });
    const updated = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        monnifyReservedAccountNumber: created.accountNumber,
        monnifyReservedAccountName: created.accountName ?? accountName,
        monnifyReservedAccountBank: created.bankName,
        monnifyReservedAccountRef: created.accountReference,
        monnifyContractCode: created.contractCode ?? dto.contractCode ?? workspace.monnifyContractCode,
      },
    });
    await this.audit.record(workspaceId, actor, 'wallet.account_provisioned', created.accountNumber, {
      bank: created.bankName,
      accountReference: created.accountReference,
    });
    return this.accountOf(updated);
  }

  async linkAccount(workspaceId: string, actor: AuditActor, dto: LinkReservedAccountDto) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.monnifyReservedAccountNumber) {
      throw new BadRequestException('A wallet account is already linked. Unlink it first.');
    }
    const clash = await this.prisma.workspace.findFirst({
      where: { id: { not: workspaceId }, monnifyReservedAccountRef: dto.accountReference },
      select: { id: true },
    });
    if (clash) throw new BadRequestException('That reserved account is already linked to another workspace');

    const found = await this.monnifyService.getReservedAccount(dto.accountReference);
    if (!found) throw new BadRequestException('Monnify has no reserved account with that reference');
    const account = dto.accountNumber ? found.accounts.find((a) => a.accountNumber === dto.accountNumber) : found.accounts[0];
    if (!account) {
      throw new BadRequestException('That account number does not belong to the reserved account reference given');
    }
    const updated = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        monnifyReservedAccountNumber: account.accountNumber,
        monnifyReservedAccountName: found.accountName ?? dto.accountName ?? workspace.name,
        monnifyReservedAccountBank: account.bankName ?? dto.bankName ?? null,
        monnifyReservedAccountRef: found.accountReference,
        monnifyContractCode: found.contractCode ?? workspace.monnifyContractCode,
      },
    });
    await this.audit.record(workspaceId, actor, 'wallet.account_linked', account.accountNumber, { accountReference: found.accountReference });
    return this.accountOf(updated);
  }

  /** "Rename to workspace". Local display name only (see comment in MonnifyService). */
  async renameAccount(workspaceId: string, actor: AuditActor, dto: RenameReservedAccountDto) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace?.monnifyReservedAccountNumber) throw new BadRequestException('No wallet account is linked');
    const name = dto.accountName?.trim() || workspace.name;
    const updated = await this.prisma.workspace.update({ where: { id: workspaceId }, data: { monnifyReservedAccountName: name } });
    await this.audit.record(workspaceId, actor, 'wallet.account_renamed', workspace.monnifyReservedAccountNumber, {
      from: workspace.monnifyReservedAccountName,
      to: name,
    });
    return this.accountOf(updated);
  }

  async unlinkAccount(workspaceId: string, actor: AuditActor) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace?.monnifyReservedAccountNumber) throw new BadRequestException('No wallet account is linked');
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        monnifyReservedAccountNumber: null,
        monnifyReservedAccountName: null,
        monnifyReservedAccountBank: null,
        monnifyReservedAccountRef: null,
      },
    });
    await this.audit.record(workspaceId, actor, 'wallet.account_unlinked', workspace.monnifyReservedAccountNumber, {
      accountReference: workspace.monnifyReservedAccountRef,
    });
    return { unlinked: true };
  }

  // ─── Card / checkout top-up ───────────────────────────────────────────────

  /**
   * Creates a PENDING WalletTopup and a Monnify checkout. The wallet is only credited when the
   * collection webhook (or reconciliation) confirms it, through recordTopup().
   */
  async topUp(workspaceId: string, dto: TopUpDto) {
    const topup = await runIdempotent(this.prisma, workspaceId, 'WALLET_TOPUP', dto.clientRequestId, async (tx) => {
      const reference = `PIF-TOPUP-${workspaceId.slice(0, 8)}-${Date.now()}`;
      return tx.walletTopup.create({
        data: { workspaceId, amount: dto.amount, reference, source: 'CARD', status: 'PENDING' },
      });
    });

    try {
      const init = await this.monnifyService.initializeTransaction({
        amount: toNum(topup.amount),
        reference: topup.reference,
        customerEmail: `workspace-${workspaceId}@paidinfull.app`,
        customerName: `Workspace ${workspaceId}`,
        redirectUrl: dto.redirectUrl,
      });
      return { ...topup, checkoutUrl: init.checkoutUrl };
    } catch (error) {
      return { ...topup, checkoutUrl: undefined, initError: error instanceof Error ? error.message : 'unknown error' };
    }
  }
}
