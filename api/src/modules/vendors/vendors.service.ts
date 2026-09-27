import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../../common';
import { MonnifyService } from '../monnify/monnify.service';
import { CreateVendorDto, UpdateVendorDto, VendorQueryDto, VerifyAccountDto } from './dto';

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly monnifyService: MonnifyService,
  ) {}

  async list(workspaceId: string, query: VendorQueryDto) {
    const { page = 1, limit = 20, search } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.VendorWhereInput = {
      workspaceId,
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    };

    const [vendors, total] = await Promise.all([
      this.prisma.vendor.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } }),
      this.prisma.vendor.count({ where }),
    ]);

    return paginate(vendors, total, page, limit);
  }

  async listBanks() {
    return this.monnifyService.listBanks();
  }

  async verifyAccount(dto: VerifyAccountDto) {
    return this.monnifyService.verifyBankAccount(dto.accountNumber, dto.bankCode);
  }

  async findOne(workspaceId: string, id: string) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id, workspaceId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  async create(workspaceId: string, dto: CreateVendorDto) {
    let accountName: string | undefined;
    let isBankVerified = false;
    let bankName: string | undefined;

    if (dto.bankAccountNumber && dto.bankCode) {
      try {
        const result = await this.monnifyService.verifyBankAccount(dto.bankAccountNumber, dto.bankCode);
        accountName = result.accountName;
        isBankVerified = true;
        const banks = await this.monnifyService.listBanks();
        bankName = banks.find((b) => b.code === dto.bankCode)?.name;
      } catch (error) {
        this.logger.warn(
          `Bank verification failed while creating vendor "${dto.name}" — saving unverified: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    return this.prisma.vendor.create({
      data: {
        workspaceId,
        name: dto.name,
        contactPerson: dto.contactPerson,
        phone: dto.phone,
        email: dto.email,
        bankAccountNumber: dto.bankAccountNumber,
        bankCode: dto.bankCode,
        bankName,
        accountName,
        isBankVerified,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(workspaceId: string, id: string, dto: UpdateVendorDto) {
    await this.findOne(workspaceId, id);

    let accountName: string | undefined;
    let isBankVerified: boolean | undefined;
    let bankName: string | undefined;

    if (dto.bankAccountNumber && dto.bankCode) {
      try {
        const result = await this.monnifyService.verifyBankAccount(dto.bankAccountNumber, dto.bankCode);
        accountName = result.accountName;
        isBankVerified = true;
        const banks = await this.monnifyService.listBanks();
        bankName = banks.find((b) => b.code === dto.bankCode)?.name;
      } catch (error) {
        isBankVerified = false;
        this.logger.warn(
          `Bank verification failed while updating vendor ${id} — saving unverified: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    return this.prisma.vendor.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.contactPerson !== undefined && { contactPerson: dto.contactPerson }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.bankAccountNumber !== undefined && { bankAccountNumber: dto.bankAccountNumber }),
        ...(dto.bankCode !== undefined && { bankCode: dto.bankCode }),
        ...(bankName !== undefined && { bankName }),
        ...(accountName !== undefined && { accountName }),
        ...(isBankVerified !== undefined && { isBankVerified }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(workspaceId: string, id: string) {
    await this.findOne(workspaceId, id);
    return this.prisma.vendor.update({ where: { id }, data: { isActive: false } });
  }
}
