import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { paginate, PaginationDto } from '../../common';
import { CreateSettlementBatchDto, CreateSettlementBatchItemsDto } from './dto';
import { SettlementItemStatus } from '@prisma/client';

const AMOUNT_EPSILON = 0.01;

@Injectable()
export class SettlementService {
  constructor(private prisma: PrismaService) {}

  async findAll(workspaceId: string, pagination: PaginationDto) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const [data, total] = await Promise.all([
      this.prisma.settlementBatch.findMany({
        where: { workspaceId },
        include: { batch: true, items: true },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { id: 'desc' },
      }),
      this.prisma.settlementBatch.count({ where: { workspaceId } }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(workspaceId: string, id: string) {
    const record = await this.prisma.settlementBatch.findFirst({
      where: { id, workspaceId },
      include: { batch: true, items: true },
    });
    if (!record) throw new NotFoundException('Settlement batch not found');
    return record;
  }

  async createSettlementBatch(workspaceId: string, dto: CreateSettlementBatchDto) {
    const batch = await this.prisma.batch.findFirst({ where: { id: dto.batchId, workspaceId } });
    if (!batch) throw new NotFoundException('Batch not found in this workspace');

    const existing = await this.prisma.settlementBatch.findUnique({ where: { batchId: dto.batchId } });
    if (existing) {
      throw new ConflictException('A settlement batch already exists for this Batch');
    }

    return this.prisma.settlementBatch.create({
      data: {
        workspaceId,
        batchId: dto.batchId,
        monnifySettlementRef: dto.monnifySettlementRef,
        expectedAmount: dto.expectedAmount,
      },
    });
  }

  async addItems(workspaceId: string, settlementBatchId: string, dto: CreateSettlementBatchItemsDto) {
    const settlementBatch = await this.prisma.settlementBatch.findFirst({
      where: { id: settlementBatchId, workspaceId },
    });
    if (!settlementBatch) throw new NotFoundException('Settlement batch not found');

    if (!dto.items?.length) {
      throw new BadRequestException('At least one settlement item is required');
    }

    const created = await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.settlementBatchItem.create({
          data: {
            settlementBatchId,
            batchItemPayoutRef: item.batchItemPayoutRef,
            amount: item.amount,
            status: SettlementItemStatus.UNMATCHED, // classified below, pre-transaction lookups aren't allowed inline
          },
        }),
      ),
    );

    // Classify each created row against the platform's own BatchItemPayout/BatchItem records.
    const classified = await Promise.all(
      created.map(async (row) => {
        const payout = await this.prisma.batchItemPayout.findUnique({
          where: { reference: row.batchItemPayoutRef },
        });

        const isMatched = !!payout && Math.abs(Number(payout.amount) - Number(row.amount)) < AMOUNT_EPSILON;

        return this.prisma.settlementBatchItem.update({
          where: { id: row.id },
          data: { status: isMatched ? SettlementItemStatus.MATCHED : SettlementItemStatus.UNMATCHED },
        });
      }),
    );

    return classified;
  }

  async markDisputed(workspaceId: string, settlementBatchId: string, itemId: string) {
    const settlementBatch = await this.prisma.settlementBatch.findFirst({
      where: { id: settlementBatchId, workspaceId },
    });
    if (!settlementBatch) throw new NotFoundException('Settlement batch not found');

    const item = await this.prisma.settlementBatchItem.findFirst({
      where: { id: itemId, settlementBatchId },
    });
    if (!item) throw new NotFoundException('Settlement batch item not found');

    return this.prisma.settlementBatchItem.update({
      where: { id: itemId },
      data: { status: SettlementItemStatus.DISPUTED },
    });
  }
}
