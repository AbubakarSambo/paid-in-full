import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../../common';
import { CreateProductDto, ProductFilterDto, UpdateProductDto } from './dto';

/** Invoicing product catalog (spec §4 products). */
@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(workspaceId: string, filter: ProductFilterDto) {
    const { page = 1, limit = 20, search, active } = filter;
    const where: Prisma.ProductWhereInput = {
      workspaceId,
      ...(active !== undefined && { isActive: active }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
      this.prisma.product.count({ where }),
    ]);
    return paginate(rows.map(present), total, page, limit);
  }

  async findOne(workspaceId: string, id: string) {
    const p = await this.prisma.product.findFirst({ where: { id, workspaceId } });
    if (!p) throw new NotFoundException('Product not found');
    return present(p);
  }

  async create(workspaceId: string, dto: CreateProductDto) {
    try {
      const p = await this.prisma.product.create({
        data: {
          workspaceId,
          name: dto.name.trim(),
          description: dto.description,
          sku: dto.sku,
          unitName: dto.unitName,
          unitPrice: dto.unitPrice,
          taxRate: dto.taxRate ?? 0,
          isActive: dto.active ?? true,
        },
      });
      return present(p);
    } catch (e) {
      throw this.mapConflict(e);
    }
  }

  async update(workspaceId: string, id: string, dto: UpdateProductDto) {
    await this.findOne(workspaceId, id);
    try {
      const p = await this.prisma.product.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.sku !== undefined && { sku: dto.sku }),
          ...(dto.unitName !== undefined && { unitName: dto.unitName }),
          ...(dto.unitPrice !== undefined && { unitPrice: dto.unitPrice }),
          ...(dto.taxRate !== undefined && { taxRate: dto.taxRate }),
          ...(dto.active !== undefined && { isActive: dto.active }),
        },
      });
      return present(p);
    } catch (e) {
      throw this.mapConflict(e);
    }
  }

  /** Invoice lines keep their copied description/price; the product link is cleared (SetNull). */
  async remove(workspaceId: string, id: string) {
    await this.findOne(workspaceId, id);
    await this.prisma.product.delete({ where: { id } });
    return { message: 'Product deleted' };
  }

  private mapConflict(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException('A product with this name already exists');
    }
    return e;
  }
}

function present<T extends { isActive: boolean }>(p: T) {
  return { ...p, active: p.isActive };
}
