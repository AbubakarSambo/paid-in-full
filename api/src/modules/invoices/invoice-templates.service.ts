import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceTemplateDto, UpdateInvoiceTemplateDto } from './dto';

@Injectable()
export class InvoiceTemplatesService {
  constructor(private prisma: PrismaService) {}

  findAll(workspaceId: string) {
    return this.prisma.invoiceTemplate.findMany({
      where: { workspaceId },
      include: { items: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, workspaceId: string) {
    const template = await this.prisma.invoiceTemplate.findFirst({
      where: { id, workspaceId },
      include: { items: true },
    });
    if (!template) throw new NotFoundException('Invoice template not found');
    return template;
  }

  create(workspaceId: string, dto: CreateInvoiceTemplateDto) {
    return this.prisma.invoiceTemplate.create({
      data: {
        workspaceId,
        name: dto.name,
        notes: dto.notes,
        items: {
          create: dto.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
      },
      include: { items: true },
    });
  }

  async update(id: string, workspaceId: string, dto: UpdateInvoiceTemplateDto) {
    await this.findOne(id, workspaceId);

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.invoiceTemplateItem.deleteMany({ where: { templateId: id } });
        await tx.invoiceTemplateItem.createMany({
          data: dto.items.map((item) => ({
            templateId: id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        });
      }

      return tx.invoiceTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
        include: { items: true },
      });
    });
  }

  async remove(id: string, workspaceId: string) {
    await this.findOne(id, workspaceId);
    await this.prisma.invoiceTemplate.delete({ where: { id } });
    return { message: 'Invoice template deleted successfully' };
  }
}
