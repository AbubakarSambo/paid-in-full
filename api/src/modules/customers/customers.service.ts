import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../../common';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  CustomerFilterDto,
  CreateCustomerCreditDto,
} from './dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async findAll(workspaceId: string, filter: CustomerFilterDto) {
    const { page = 1, limit = 20, search } = filter;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {
      workspaceId,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return paginate(customers, total, page, limit);
  }

  async findOne(id: string, workspaceId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, workspaceId },
      include: { credits: { orderBy: { createdAt: 'desc' } } },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async create(workspaceId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        workspaceId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
      },
    });
  }

  async update(id: string, workspaceId: string, dto: UpdateCustomerDto) {
    await this.assertExists(id, workspaceId);
    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.address !== undefined && { address: dto.address }),
      },
    });
  }

  async remove(id: string, workspaceId: string) {
    await this.assertExists(id, workspaceId);
    await this.prisma.customer.delete({ where: { id } });
    return { message: 'Customer deleted successfully' };
  }

  async listCredits(customerId: string, workspaceId: string) {
    await this.assertExists(customerId, workspaceId);
    return this.prisma.customerCredit.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addCredit(customerId: string, workspaceId: string, dto: CreateCustomerCreditDto) {
    await this.assertExists(customerId, workspaceId);
    return this.prisma.customerCredit.create({
      data: {
        workspaceId,
        customerId,
        amount: dto.amount,
        reason: dto.reason,
      },
    });
  }

  private async assertExists(id: string, workspaceId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, workspaceId } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }
}
