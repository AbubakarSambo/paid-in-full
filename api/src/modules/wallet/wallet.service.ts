import { BadRequestException, Inject, Injectable, forwardRef } from '@nestjs/common';
import { Prisma, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate, runIdempotent } from '../../common';
import { MonnifyService } from '../monnify/monnify.service';
import { TopUpDto, WalletLedgerQueryDto } from './dto';

function toNumber(val: Prisma.Decimal | number): number {
  return typeof val === 'number' ? val : Number(val);
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

interface ApplyMovementParams {
  signedDelta: number;
  type: WalletTransactionType;
  batchId?: string;
  reference?: string;
  notes?: string;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => MonnifyService))
    private readonly monnifyService: MonnifyService,
  ) {}

  /**
   * Workspace balance is the running sum of every WalletLedgerEntry row — recomputed on read
   * rather than cached, so it can never drift from the ledger (see module docstring in the task
   * brief: no cached-balance column on Workspace).
   */
  async getBalance(workspaceId: string): Promise<{ workspaceId: string; balance: number }> {
    const result = await this.prisma.walletLedgerEntry.aggregate({
      where: { workspaceId },
      _sum: { amount: true },
    });
    return { workspaceId, balance: round2(toNumber(result._sum.amount ?? 0)) };
  }

  private async getBalanceInTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<number> {
    const result = await tx.walletLedgerEntry.aggregate({
      where: { workspaceId },
      _sum: { amount: true },
    });
    return round2(toNumber(result._sum.amount ?? 0));
  }

  async listLedger(workspaceId: string, filter: WalletLedgerQueryDto) {
    const { page = 1, limit = 20, type, startDate, endDate } = filter;
    const skip = (page - 1) * limit;
    const where: Prisma.WalletLedgerEntryWhereInput = {
      workspaceId,
      ...(type && { type }),
      ...((startDate || endDate) && {
        createdAt: {
          ...(startDate && { gte: startDate }),
          ...(endDate && { lte: endDate }),
        },
      }),
    };

    const [entries, total] = await Promise.all([
      this.prisma.walletLedgerEntry.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.walletLedgerEntry.count({ where }),
    ]);

    return paginate(entries, total, page, limit);
  }

  /**
   * Core ledger write — the only place that ever creates a WalletLedgerEntry. Reads the current
   * balance (sum of prior entries) inside the caller's transaction and writes balanceBefore/
   * balanceAfter atomically alongside the new entry, mirroring tarione's applyMovement pattern.
   */
  private async applyMovement(tx: Prisma.TransactionClient, workspaceId: string, params: ApplyMovementParams) {
    const balanceBefore = await this.getBalanceInTx(tx, workspaceId);
    const balanceAfter = round2(balanceBefore + params.signedDelta);

    return tx.walletLedgerEntry.create({
      data: {
        workspaceId,
        type: params.type,
        amount: params.signedDelta,
        balanceBefore,
        balanceAfter,
        batchId: params.batchId,
        reference: params.reference,
        notes: params.notes,
      },
    });
  }

  /** Debits the workspace wallet. Never allowed to go negative — batches must be funded first. */
  async debit(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    params: { amount: number; type: WalletTransactionType; batchId?: string; reference?: string; notes?: string },
  ) {
    const balanceBefore = await this.getBalanceInTx(tx, workspaceId);
    const balanceAfter = round2(balanceBefore - Math.abs(params.amount));
    if (balanceAfter < 0) {
      throw new BadRequestException('Insufficient wallet balance for this debit');
    }
    return this.applyMovement(tx, workspaceId, { ...params, signedDelta: -Math.abs(params.amount) });
  }

  /** Credits the workspace wallet. */
  async credit(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    params: { amount: number; type: WalletTransactionType; batchId?: string; reference?: string; notes?: string },
  ) {
    return this.applyMovement(tx, workspaceId, { ...params, signedDelta: Math.abs(params.amount) });
  }

  /**
   * Initiates a card-charge / virtual-account top-up reference via Monnify. The wallet is NOT
   * credited here — only once the Monnify webhook confirms the collection (see
   * MonnifyService.processWebhook -> recordSweep). This method just creates the PENDING
   * WalletTopup row (wrapped in runIdempotent so a double-tap on "Top up" can never create two
   * pending references) and then best-effort calls out to Monnify to get a checkout URL.
   */
  async topUp(workspaceId: string, dto: TopUpDto) {
    const topup = await runIdempotent(this.prisma, workspaceId, 'WALLET_TOPUP', dto.clientRequestId, async (tx) => {
      const reference = `PIF-TOPUP-${workspaceId.slice(0, 8)}-${Date.now()}`;
      return tx.walletTopup.create({
        data: { workspaceId, amount: dto.amount, monnifyReference: reference, status: 'PENDING' },
      });
    });

    try {
      const init = await this.monnifyService.initializeTransaction({
        amount: toNumber(topup.amount),
        reference: topup.monnifyReference,
        customerEmail: `workspace-${workspaceId}@paidinfull.app`,
        customerName: `Workspace ${workspaceId}`,
        redirectUrl: dto.redirectUrl,
      });
      return { ...topup, checkoutUrl: init.checkoutUrl };
    } catch (error) {
      // Best-effort: the PENDING WalletTopup row still exists and can be retried/inspected even
      // if Monnify's init call itself failed transiently.
      return { ...topup, checkoutUrl: undefined, initError: error instanceof Error ? error.message : 'unknown error' };
    }
  }

  /**
   * Records a Monnify collection confirmed via webhook as a SWEEP_IN credit — called for both an
   * initiated WalletTopup completing and an unprompted transfer landing in the workspace's
   * reserved account (see MonnifyService.processWebhook). Idempotent on monnifyReference (unique
   * on WalletSweep) so a duplicate webhook delivery is a no-op.
   */
  async recordSweep(
    workspaceId: string,
    params: { monnifyReference: string; amount: number; sourceAccountNumber?: string; sourceAccountName?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.walletSweep.findUnique({ where: { monnifyReference: params.monnifyReference } });
      if (existing) return existing;

      const sweep = await tx.walletSweep.create({
        data: {
          workspaceId,
          amount: params.amount,
          monnifyReference: params.monnifyReference,
          sourceAccountNumber: params.sourceAccountNumber,
          sourceAccountName: params.sourceAccountName,
          matchedAt: new Date(),
        },
      });

      await this.credit(tx, workspaceId, {
        amount: params.amount,
        type: 'SWEEP_IN',
        reference: params.monnifyReference,
        notes: 'Monnify collection sweep',
      });

      // Resolve any funding waits this sweep now covers. Only marks them FUNDED — actually
      // re-triggering the disbursement is left to the batches endpoint / a scheduled sweep, since
      // wiring that here would need BatchesService and would reintroduce the very Wallet<->Batches
      // circular dependency this module already avoids for Monnify. See report TODO.
      const balance = await this.getBalanceInTx(tx, workspaceId);
      const waits = await tx.payoutFundingWait.findMany({ where: { workspaceId, status: 'WAITING' } });
      for (const wait of waits) {
        if (balance >= toNumber(wait.requiredAmount)) {
          await tx.payoutFundingWait.update({
            where: { id: wait.id },
            data: { status: 'FUNDED', availableAmount: balance, resolvedAt: new Date() },
          });
        }
      }

      return sweep;
    });
  }
}
