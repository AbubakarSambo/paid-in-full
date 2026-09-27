import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../../common';
import { UpsertWhtRateDto, WhtLedgerQueryDto } from './dto';

function toNumber(val: Prisma.Decimal | number): number {
  return typeof val === 'number' ? val : Number(val);
}

@Injectable()
export class WhtService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Effective rate for a pay category, in priority order: a workspace-level override, then a
   * platform-wide default for that pay category, then a true global default
   * (workspaceId=null, payCategoryId=null). Returns 0 if nothing matches — no silent surprise
   * withholding.
   */
  async getEffectiveRate(workspaceId: string, payCategoryId: string | null): Promise<number> {
    if (payCategoryId) {
      const override = await this.prisma.whtRate.findFirst({ where: { workspaceId, payCategoryId } });
      if (override) return toNumber(override.ratePercent);

      const platformDefault = await this.prisma.whtRate.findFirst({ where: { workspaceId: null, payCategoryId } });
      if (platformDefault) return toNumber(platformDefault.ratePercent);
    }

    const globalDefault = await this.prisma.whtRate.findFirst({ where: { workspaceId: null, payCategoryId: null } });
    return globalDefault ? toNumber(globalDefault.ratePercent) : 0;
  }

  async listRates(workspaceId: string) {
    const payCategories = await this.prisma.payCategory.findMany({ where: { workspaceId, isActive: true } });
    return Promise.all(
      payCategories.map(async (category) => {
        const override = await this.prisma.whtRate.findFirst({ where: { workspaceId, payCategoryId: category.id } });
        const effectiveRate = await this.getEffectiveRate(workspaceId, category.id);
        return {
          payCategoryId: category.id,
          payCategoryName: category.name,
          effectiveRatePercent: effectiveRate,
          hasWorkspaceOverride: !!override,
          overrideId: override?.id,
        };
      }),
    );
  }

  async upsertRate(workspaceId: string, payCategoryId: string, dto: UpsertWhtRateDto) {
    const payCategory = await this.prisma.payCategory.findFirst({ where: { id: payCategoryId, workspaceId } });
    if (!payCategory) throw new NotFoundException('Pay category not found');

    const existing = await this.prisma.whtRate.findFirst({ where: { workspaceId, payCategoryId } });
    if (existing) {
      return this.prisma.whtRate.update({
        where: { id: existing.id },
        data: { ratePercent: dto.ratePercent, description: dto.description },
      });
    }
    return this.prisma.whtRate.create({
      data: { workspaceId, payCategoryId, ratePercent: dto.ratePercent, description: dto.description },
    });
  }

  async removeRateOverride(workspaceId: string, payCategoryId: string) {
    const existing = await this.prisma.whtRate.findFirst({ where: { workspaceId, payCategoryId } });
    if (!existing) throw new NotFoundException('No workspace override set for this pay category');
    await this.prisma.whtRate.delete({ where: { id: existing.id } });
    return { success: true };
  }

  async listLedger(workspaceId: string, query: WhtLedgerQueryDto) {
    const { page = 1, limit = 20, taxPeriod } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.WhtLedgerWhereInput = {
      workspaceId,
      ...(taxPeriod && { taxPeriod }),
    };

    const [entries, total] = await Promise.all([
      this.prisma.whtLedger.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { vendor: { select: { id: true, name: true } } },
      }),
      this.prisma.whtLedger.count({ where }),
    ]);

    return paginate(entries, total, page, limit);
  }
}
