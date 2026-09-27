import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBillingPlanDto, UpdateBillingPlanDto } from './dto';

@Injectable()
export class BillingPlansService {
  constructor(private prisma: PrismaService) {}

  // Public — the marketing site's pricing page reads this.
  findAll() {
    return this.prisma.billingPlan.findMany({ orderBy: { priceMonthly: 'asc' } });
  }

  async findOne(id: string) {
    const plan = await this.prisma.billingPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Billing plan not found');
    return plan;
  }

  create(dto: CreateBillingPlanDto) {
    return this.prisma.billingPlan.create({
      data: {
        tier: dto.tier,
        name: dto.name,
        priceMonthly: dto.priceMonthly,
        features: dto.features as any,
      },
    });
  }

  async update(id: string, dto: UpdateBillingPlanDto) {
    await this.findOne(id);
    return this.prisma.billingPlan.update({
      where: { id },
      data: {
        ...(dto.tier !== undefined ? { tier: dto.tier } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.priceMonthly !== undefined ? { priceMonthly: dto.priceMonthly } : {}),
        ...(dto.features !== undefined ? { features: dto.features as any } : {}),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.billingPlan.delete({ where: { id } });
    return { success: true };
  }
}
