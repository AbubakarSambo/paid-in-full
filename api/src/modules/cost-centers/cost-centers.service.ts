import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCostCenterDto, UpdateCostCenterDto } from './dto';

@Injectable()
export class CostCentersService {
  constructor(private prisma: PrismaService) {}

  async findAll(workspaceId: string) {
    return this.prisma.costCenter.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
    });
  }

  async create(workspaceId: string, dto: CreateCostCenterDto) {
    try {
      return await this.prisma.costCenter.create({
        data: { workspaceId, name: dto.name },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A cost center with this name already exists');
      }
      throw error;
    }
  }

  async update(workspaceId: string, id: string, dto: UpdateCostCenterDto) {
    const existing = await this.prisma.costCenter.findFirst({ where: { id, workspaceId } });
    if (!existing) {
      throw new NotFoundException('Cost center not found');
    }

    try {
      return await this.prisma.costCenter.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A cost center with this name already exists');
      }
      throw error;
    }
  }

  async remove(workspaceId: string, id: string) {
    const existing = await this.prisma.costCenter.findFirst({ where: { id, workspaceId } });
    if (!existing) {
      throw new NotFoundException('Cost center not found');
    }

    await this.prisma.costCenter.update({
      where: { id },
      data: { isActive: false },
    });

    return { success: true };
  }
}
