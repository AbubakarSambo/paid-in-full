import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../../common';
import { ListWorkspacesDto } from './dto/list-workspaces.dto';
import { ToggleGrandfatherDto } from './dto/toggle-grandfather.dto';

@Injectable()
export class PlatformWorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListWorkspacesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.WorkspaceWhereInput = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.planTier) where.planTier = query.planTier;
    if (query.subscriptionStatus) where.subscriptionStatus = query.subscriptionStatus;

    const [data, total] = await Promise.all([
      this.prisma.workspace.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          currency: true,
          planTier: true,
          subscriptionStatus: true,
          trialEndDate: true,
          subscriptionEndDate: true,
          isGrandfathered: true,
          createdAt: true,
        },
      }),
      this.prisma.workspace.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      include: {
        _count: {
          select: { members: true, vendors: true, batches: true, queueItems: true },
        },
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  async toggleGrandfather(id: string, dto: ToggleGrandfatherDto) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id }, select: { isGrandfathered: true } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const nextValue = dto.isGrandfathered !== undefined ? dto.isGrandfathered : !workspace.isGrandfathered;

    return this.prisma.workspace.update({
      where: { id },
      data: { isGrandfathered: nextValue },
      select: { id: true, name: true, isGrandfathered: true },
    });
  }
}
