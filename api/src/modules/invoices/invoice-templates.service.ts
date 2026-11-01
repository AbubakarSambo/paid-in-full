import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceTemplateDto, InvoiceItemDto, UpdateInvoiceTemplateDto } from './dto';

@Injectable()
export class InvoiceTemplatesService {
  constructor(private prisma: PrismaService) {}

  findAll(workspaceId: string) {
    return this.prisma.invoiceTemplate.findMany({
      where: { workspaceId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, workspaceId: string) {
    const template = await this.prisma.invoiceTemplate.findFirst({
      where: { id, workspaceId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) throw new NotFoundException('Invoice template not found');
    return template;
  }

  private async itemRows(workspaceId: string, items: InvoiceItemDto[]) {
    const ids = items.map((i) => i.productId).filter((x): x is string => !!x);
    const products = ids.length ? await this.prisma.product.findMany({ where: { workspaceId, id: { in: ids } } }) : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    return items.map((item, i) => {
      const p = item.productId ? byId.get(item.productId) : undefined;
      return {
        productId: p?.id ?? null,
        description: item.description?.trim() || p?.name || 'Item',
        quantity: item.quantity,
        unitPrice: item.unitPrice ?? (p ? Number(p.unitPrice) : 0),
        vatRate: item.vatRate ?? (p ? Number(p.taxRate) : 0),
        whtRate: item.whtRate ?? 0,
        sortOrder: i,
      };
    });
  }

  async create(workspaceId: string, dto: CreateInvoiceTemplateDto) {
    return this.prisma.invoiceTemplate.create({
      data: {
        workspaceId,
        name: dto.name,
        notes: dto.notes,
        terms: dto.terms,
        currency: dto.currency?.toUpperCase(),
        settings: (dto.settings ?? undefined) as Prisma.InputJsonValue | undefined,
        items: { create: await this.itemRows(workspaceId, dto.items) },
      },
      include: { items: true },
    });
  }

  async update(id: string, workspaceId: string, dto: UpdateInvoiceTemplateDto) {
    await this.findOne(id, workspaceId);
    const rows = dto.items ? await this.itemRows(workspaceId, dto.items) : null;
    return this.prisma.$transaction(async (tx) => {
      if (rows) {
        await tx.invoiceTemplateItem.deleteMany({ where: { templateId: id } });
        await tx.invoiceTemplateItem.createMany({ data: rows.map((r) => ({ ...r, templateId: id })) });
      }
      return tx.invoiceTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.terms !== undefined && { terms: dto.terms }),
          ...(dto.currency !== undefined && { currency: dto.currency.toUpperCase() }),
          ...(dto.settings !== undefined && { settings: dto.settings as Prisma.InputJsonValue }),
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
