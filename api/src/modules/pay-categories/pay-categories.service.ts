import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePayCategoryDto, UpdatePayCategoryDto } from './dto';

@Injectable()
export class PayCategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll(workspaceId: string) {
    return this.prisma.payCategory.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
    });
  }

  async create(workspaceId: string, dto: CreatePayCategoryDto) {
    try {
      return await this.prisma.payCategory.create({
        data: { workspaceId, name: dto.name, code: dto.code },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A pay category with this name already exists');
      }
      throw error;
    }
  }

  async update(workspaceId: string, id: string, dto: UpdatePayCategoryDto) {
    const existing = await this.prisma.payCategory.findFirst({ where: { id, workspaceId } });
    if (!existing) {
      throw new NotFoundException('Pay category not found');
    }

    try {
      return await this.prisma.payCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.code !== undefined && { code: dto.code }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A pay category with this name already exists');
      }
      throw error;
    }
  }

  async remove(workspaceId: string, id: string) {
    const existing = await this.prisma.payCategory.findFirst({ where: { id, workspaceId } });
    if (!existing) {
      throw new NotFoundException('Pay category not found');
    }

    await this.prisma.payCategory.update({
      where: { id },
      data: { isActive: false },
    });

    return { success: true };
  }
}
