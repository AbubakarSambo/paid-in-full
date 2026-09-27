import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../../common';
import { CreateRequisitionDto, PushToQueueDto, RejectRequisitionDto, RequisitionQueryDto } from './dto';

@Injectable()
export class RequisitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(workspaceId: string, userId: string, dto: CreateRequisitionDto) {
    return this.prisma.requisition.create({
      data: {
        workspaceId,
        requestedById: userId,
        vendorId: dto.vendorId,
        payCategoryId: dto.payCategoryId,
        costCenterId: dto.costCenterId,
        locationId: dto.locationId,
        description: dto.description,
        amount: dto.amount,
      },
    });
  }

  async list(workspaceId: string, query: RequisitionQueryDto) {
    const { page = 1, limit = 20, status } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.RequisitionWhereInput = { workspaceId, ...(status && { status }) };

    const [requisitions, total] = await Promise.all([
      this.prisma.requisition.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { vendor: true, payCategory: true, costCenter: true, location: true },
      }),
      this.prisma.requisition.count({ where }),
    ]);

    return paginate(requisitions, total, page, limit);
  }

  async findOne(workspaceId: string, id: string) {
    const requisition = await this.prisma.requisition.findFirst({
      where: { id, workspaceId },
      include: { vendor: true, payCategory: true, costCenter: true, location: true, queueItem: true },
    });
    if (!requisition) throw new NotFoundException('Requisition not found');
    return requisition;
  }

  async approve(workspaceId: string, id: string, approverId: string) {
    const requisition = await this.findOne(workspaceId, id);
    if (requisition.status !== 'PENDING') {
      throw new BadRequestException(`Cannot approve a requisition in ${requisition.status} status`);
    }
    return this.prisma.requisition.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: approverId, approvedAt: new Date() },
    });
  }

  async reject(workspaceId: string, id: string, approverId: string, dto: RejectRequisitionDto) {
    const requisition = await this.findOne(workspaceId, id);
    if (requisition.status !== 'PENDING') {
      throw new BadRequestException(`Cannot reject a requisition in ${requisition.status} status`);
    }
    return this.prisma.requisition.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approvedById: approverId,
        approvedAt: new Date(),
        rejectionReason: dto.rejectionReason,
      },
    });
  }

  /**
   * Mirrors the Supabase reference schema's push_requisitions_to_queue: for each APPROVED
   * requisition with no existing QueueItem, atomically snapshot it into a new QueueItem and mark
   * the requisition PUSHED_TO_QUEUE. QueueItem.vendorId is non-nullable in this schema even though
   * Requisition.vendorId is optional — a requisition with no vendor can't be pushed and is
   * reported as a per-row error rather than silently skipped or force-failing the whole batch.
   */
  async pushToQueue(workspaceId: string, userId: string, dto: PushToQueueDto) {
    const pushed: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const requisitionId of dto.requisitionIds) {
        const requisition = await tx.requisition.findFirst({
          where: { id: requisitionId, workspaceId },
          include: { queueItem: true },
        });

        if (!requisition) {
          skipped.push({ id: requisitionId, reason: 'Not found' });
          continue;
        }
        if (requisition.status !== 'APPROVED') {
          skipped.push({ id: requisitionId, reason: `Status is ${requisition.status}, must be APPROVED` });
          continue;
        }
        if (requisition.queueItem) {
          skipped.push({ id: requisitionId, reason: 'Already pushed to queue' });
          continue;
        }
        if (!requisition.vendorId) {
          skipped.push({ id: requisitionId, reason: 'No vendor set on requisition — cannot create a queue item without one' });
          continue;
        }

        await tx.queueItem.create({
          data: {
            workspaceId,
            requisitionId: requisition.id,
            vendorId: requisition.vendorId,
            payCategoryId: requisition.payCategoryId,
            costCenterId: requisition.costCenterId,
            locationId: requisition.locationId,
            description: requisition.description,
            amount: requisition.amount,
            createdById: userId,
          },
        });

        await tx.requisition.update({ where: { id: requisition.id }, data: { status: 'PUSHED_TO_QUEUE' } });
        pushed.push(requisition.id);
      }
    });

    return { pushed, skipped };
  }
}
