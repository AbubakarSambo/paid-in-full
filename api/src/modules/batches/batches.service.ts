import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate, runIdempotent } from '../../common';
import { MonnifyService } from '../monnify/monnify.service';
import { WalletService } from '../wallet/wallet.service';
import { WhtService } from '../wht/wht.service';
import { BatchQueryDto, CreateBatchDto, DisburseBatchDto } from './dto';

function toNumber(val: Prisma.Decimal | number): number {
  return typeof val === 'number' ? val : Number(val);
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

const BATCH_ITEMS_INCLUDE = {
  items: { include: { vendor: true, queueItem: true, payout: true, whtLedger: true } },
} satisfies Prisma.BatchInclude;

@Injectable()
export class BatchesService {
  private readonly logger = new Logger(BatchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly monnifyService: MonnifyService,
    private readonly whtService: WhtService,
  ) {}

  async list(workspaceId: string, query: BatchQueryDto) {
    const { page = 1, limit = 20, status } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.BatchWhereInput = { workspaceId, ...(status && { status }) };

    const [batches, total] = await Promise.all([
      this.prisma.batch.findMany({ where, skip, take: limit, orderBy: { batchNumber: 'desc' } }),
      this.prisma.batch.count({ where }),
    ]);

    return paginate(batches, total, page, limit);
  }

  async findOne(workspaceId: string, id: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id, workspaceId },
      include: BATCH_ITEMS_INCLUDE,
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  /**
   * Groups a set of PENDING/APPROVED_FOR_BATCH queue items into a new Batch. Snapshots each into
   * a BatchItem with computed WHT, using an auto-incrementing per-workspace batchNumber. Batch
   * totalAmount is the gross liability (sum of BatchItem.grossAmount); the actual wallet debit at
   * disbursement time is the net total (grossAmount minus withheld WHT), since WHT is retained,
   * not transferred to the vendor — see disburse().
   */
  async create(workspaceId: string, userId: string, dto: CreateBatchDto) {
    return this.prisma.$transaction(async (tx) => {
      const queueItems = await tx.queueItem.findMany({
        where: {
          id: { in: dto.queueItemIds },
          workspaceId,
          status: { in: ['PENDING', 'APPROVED_FOR_BATCH'] },
        },
      });

      if (queueItems.length === 0) {
        throw new BadRequestException('None of the given queue item ids are eligible to batch (must be PENDING or APPROVED_FOR_BATCH)');
      }

      const lastBatch = await tx.batch.findFirst({ where: { workspaceId }, orderBy: { batchNumber: 'desc' } });
      const batchNumber = (lastBatch?.batchNumber ?? 0) + 1;

      let totalGross = 0;
      const itemsData: Prisma.BatchItemCreateManyBatchInput[] = [];

      for (const queueItem of queueItems) {
        const gross = toNumber(queueItem.amount);
        const ratePercent = await this.whtService.getEffectiveRate(workspaceId, queueItem.payCategoryId);
        const whtAmount = round2((gross * ratePercent) / 100);
        const netAmount = round2(gross - whtAmount);
        totalGross = round2(totalGross + gross);

        itemsData.push({
          queueItemId: queueItem.id,
          vendorId: queueItem.vendorId,
          grossAmount: gross,
          whtAmount,
          netAmount,
        });
      }

      const batch = await tx.batch.create({
        data: {
          workspaceId,
          batchNumber,
          status: 'PENDING_APPROVAL',
          totalAmount: totalGross,
          createdById: userId,
          items: { createMany: { data: itemsData } },
        },
        include: BATCH_ITEMS_INCLUDE,
      });

      await tx.queueItem.updateMany({
        where: { id: { in: queueItems.map((q) => q.id) } },
        data: { status: 'BATCHED' },
      });

      return batch;
    });
  }

  /**
   * Flips PENDING_APPROVAL -> APPROVED and checks wallet funding. Per the task brief, an
   * insufficient balance does NOT fail the approval — it creates a PayoutFundingWait row and the
   * batch is left APPROVED (but effectively blocked from disbursing until funded; disburse()
   * re-checks the balance anyway).
   */
  async approve(workspaceId: string, id: string, userId: string) {
    const batch = await this.findOne(workspaceId, id);
    if (batch.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Cannot approve a batch in ${batch.status} status`);
    }

    const netTotal = round2(batch.items.reduce((sum, item) => sum + toNumber(item.netAmount), 0));
    const { balance } = await this.walletService.getBalance(workspaceId);

    await this.prisma.batch.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
    });

    if (balance < netTotal) {
      await this.prisma.payoutFundingWait.create({
        data: { workspaceId, batchId: id, requiredAmount: netTotal, availableAmount: balance, status: 'WAITING' },
      });
      this.logger.warn(`Batch ${id} approved but wallet balance (${balance}) < required (${netTotal}) — PayoutFundingWait created`);
    }

    return this.findOne(workspaceId, id);
  }

  /**
   * Debits the wallet and fans out one Monnify single-transfer call per BatchItem. Wrapped in
   * runIdempotent keyed by clientRequestId so a double-tap on "Disburse" can never double-debit
   * the wallet or double-initiate transfers. Returns once transfers are *initiated*, not once
   * Monnify confirms them — final per-item outcomes land via the Monnify webhook (see
   * MonnifyService.processWebhook), which also flips the Batch to DISBURSED/PARTIALLY_FAILED.
   */
  async disburse(workspaceId: string, id: string, userId: string, dto: DisburseBatchDto) {
    const { batch, netTotal } = await runIdempotent(this.prisma, workspaceId, 'BATCH_DISBURSE', dto.clientRequestId, async (tx) => {
      const existing = await tx.batch.findFirst({ where: { id, workspaceId }, include: BATCH_ITEMS_INCLUDE });
      if (!existing) throw new NotFoundException('Batch not found');
      if (existing.status !== 'APPROVED') {
        throw new BadRequestException(`Cannot disburse a batch in ${existing.status} status`);
      }

      const total = round2(existing.items.reduce((sum, item) => sum + toNumber(item.netAmount), 0));

      await this.walletService.debit(tx, workspaceId, {
        amount: total,
        type: 'DISBURSEMENT',
        batchId: id,
        reference: `BATCH-${existing.batchNumber}`,
        notes: `Disbursement for batch #${existing.batchNumber}`,
      });

      // Resolve any funding wait this disbursement satisfies.
      await tx.payoutFundingWait.updateMany({
        where: { workspaceId, batchId: id, status: 'WAITING' },
        data: { status: 'FUNDED', resolvedAt: new Date() },
      });

      for (const item of existing.items) {
        const monnifyReference = `PIF-BI-${item.id.slice(0, 8)}-${Date.now()}`;
        await tx.batchItemPayout.create({
          data: { batchItemId: item.id, monnifyReference, status: 'PENDING' },
        });

        if (toNumber(item.whtAmount) > 0) {
          await tx.whtLedger.create({
            data: {
              workspaceId,
              batchItemId: item.id,
              vendorId: item.vendorId,
              grossAmount: item.grossAmount,
              whtRate: round2((toNumber(item.whtAmount) / toNumber(item.grossAmount)) * 100),
              whtAmount: item.whtAmount,
              taxPeriod: startOfMonth(new Date()),
            },
          });
        }
      }

      const updated = await tx.batch.update({ where: { id }, data: { status: 'DISBURSING' }, include: BATCH_ITEMS_INCLUDE });
      return { batch: updated, netTotal: total };
    });

    // Outside the transaction/idempotency wrapper — each Monnify call is independent, and one
    // item's failure must never roll back or block the others.
    for (const item of batch.items) {
      const payout = item.payout;
      if (!payout) continue;

      const vendor = item.vendor;
      if (!vendor.bankAccountNumber || !vendor.bankCode) {
        await this.prisma.batchItemPayout.update({
          where: { id: payout.id },
          data: { status: 'FAILED', failureReason: 'Vendor has no verified bank account on file', completedAt: new Date() },
        });
        continue;
      }

      try {
        await this.monnifyService.initiateSingleTransfer({
          amount: toNumber(item.netAmount),
          reference: payout.monnifyReference,
          narration: `Payment for ${vendor.name} — batch #${batch.batchNumber}`,
          destinationAccountNumber: vendor.bankAccountNumber,
          destinationBankCode: vendor.bankCode,
          destinationAccountName: vendor.accountName ?? vendor.name,
        });
        await this.prisma.batchItemPayout.update({ where: { id: payout.id }, data: { status: 'PROCESSING' } });
      } catch (error) {
        this.logger.error(`Monnify transfer initiation failed for batch item ${item.id} (ref ${payout.monnifyReference}): ${error instanceof Error ? error.message : 'unknown error'}`);
        await this.prisma.batchItemPayout.update({
          where: { id: payout.id },
          data: { status: 'FAILED', failureReason: error instanceof Error ? error.message : 'Unknown error', completedAt: new Date() },
        });
      }
    }

    // If every payout already resolved synchronously (e.g. everything failed at initiation, with
    // no webhook ever going to arrive for those), settle the batch's final status now rather than
    // leaving it stuck at DISBURSING forever.
    const finalPayouts = await this.prisma.batchItemPayout.findMany({ where: { batchItem: { batchId: id } } });
    const allResolved = finalPayouts.every((p) => p.status === 'SUCCESS' || p.status === 'FAILED' || p.status === 'REVERSED');
    if (allResolved) {
      const anyFailed = finalPayouts.some((p) => p.status === 'FAILED' || p.status === 'REVERSED');
      await this.prisma.batch.update({
        where: { id },
        data: { status: anyFailed ? 'PARTIALLY_FAILED' : 'DISBURSED', disbursedAt: new Date() },
      });
    }

    this.logger.log(`Batch ${id} disbursement initiated — net total ${netTotal}, ${batch.items.length} transfer(s) in flight`);
    return this.findOne(workspaceId, id);
  }
}
