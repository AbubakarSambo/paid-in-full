import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLocationDto, UpdateLocationDto } from './dto';

@Injectable()
export class LocationsService {
  constructor(private prisma: PrismaService) {}

  async findAll(workspaceId: string) {
    return this.prisma.location.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
    });
  }

  async create(workspaceId: string, dto: CreateLocationDto) {
    try {
      return await this.prisma.location.create({
        data: { workspaceId, name: dto.name, address: dto.address },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A location with this name already exists');
      }
      throw error;
    }
  }

  async update(workspaceId: string, id: string, dto: UpdateLocationDto) {
    const existing = await this.prisma.location.findFirst({ where: { id, workspaceId } });
    if (!existing) {
      throw new NotFoundException('Location not found');
    }

    try {
      return await this.prisma.location.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.address !== undefined && { address: dto.address }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A location with this name already exists');
      }
      throw error;
    }
  }

  async remove(workspaceId: string, id: string) {
    const existing = await this.prisma.location.findFirst({ where: { id, workspaceId } });
    if (!existing) {
      throw new NotFoundException('Location not found');
    }

    await this.prisma.location.update({
      where: { id },
      data: { isActive: false },
    });

    return { success: true };
  }
}
