import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditActor, AuditLogService } from '../platform/audit-log.service';
import { AiService } from '../ai/ai.service';
import { AUDIT_ACTIONS, normalizeCsvHeader, parseCsvRows, toCsv } from '../../common';
import { coaDefaultsForIndustry, DEFAULT_CATEGORY_META } from './coa-defaults';
import { assertCoaBelongsToCategory } from './coa-tags.validation';
import { CreateCoaTagDto, DefaultSetupDto, ImportCoaTagsDto, SuggestCoaTagsDto, UpdateCoaTagDto } from './dto';

type Client = PrismaService | Prisma.TransactionClient;

@Injectable()
export class CoaTagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly ai: AiService,
  ) {}

  /** Validation helper for other modules (see coa-tags.validation.ts for the tx-friendly form). */
  assertCoaBelongsToCategory(workspaceId: string, coaTagId: string | null | undefined, payCategoryId: string | null | undefined) {
    return assertCoaBelongsToCategory(this.prisma, workspaceId, coaTagId, payCategoryId);
  }

  async list(workspaceId: string, opts: { payCategoryId?: string; includeInactive?: boolean } = {}) {
    return this.prisma.coaTag.findMany({
      where: {
        workspaceId,
        ...(opts.payCategoryId && { payCategoryId: opts.payCategoryId }),
        ...(!opts.includeInactive && { isActive: true }),
      },
      include: { payCategory: { select: { id: true, name: true, color: true } } },
      orderBy: [{ payCategory: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** Settings view: every category with its tags. */
  async byCategory(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { industry: true } });
    const categories = await this.prisma.payCategory.findMany({
      where: { workspaceId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { coaTags: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
    });
    return { industry: workspace?.industry ?? null, categories };
  }

  private async category(workspaceId: string, payCategoryId: string, client: Client = this.prisma) {
    const cat = await client.payCategory.findFirst({ where: { id: payCategoryId, workspaceId } });
    if (!cat) throw new NotFoundException('Pay category not found');
    return cat;
  }

  private async findTag(workspaceId: string, id: string) {
    const tag = await this.prisma.coaTag.findFirst({ where: { id, workspaceId }, include: { payCategory: { select: { name: true } } } });
    if (!tag) throw new NotFoundException('COA tag not found');
    return tag;
  }

  async create(workspaceId: string, dto: CreateCoaTagDto, actor?: AuditActor) {
    const cat = await this.category(workspaceId, dto.payCategoryId);
    const name = dto.name.replace(/\s+/g, ' ').trim();
    const existing = await this.prisma.coaTag.findFirst({
      where: { payCategoryId: cat.id, name: { equals: name, mode: 'insensitive' } },
    });
    if (existing?.isActive) throw new ConflictException(`"${existing.name}" already exists in ${cat.name}`);
    const agg = await this.prisma.coaTag.aggregate({ where: { payCategoryId: cat.id }, _max: { sortOrder: true } });
    const tag = existing
      ? await this.prisma.coaTag.update({ where: { id: existing.id }, data: { isActive: true, name } })
      : await this.prisma.coaTag.create({
          data: { workspaceId, payCategoryId: cat.id, name, sortOrder: (agg._max.sortOrder ?? -1) + 1 },
        });
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `COA ${cat.name} · ${tag.name}`, { action: 'coa.created', coaTagId: tag.id });
    return tag;
  }

  async update(workspaceId: string, id: string, dto: UpdateCoaTagDto, actor?: AuditActor) {
    const tag = await this.findTag(workspaceId, id);
    const name = dto.name?.replace(/\s+/g, ' ').trim();
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.coaTag.update({
          where: { id },
          data: {
            ...(name !== undefined && { name }),
            ...(dto.isActive !== undefined && { isActive: dto.isActive }),
            ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
          },
        });
        if (name !== undefined && name !== tag.name) {
          await tx.queueItem.updateMany({ where: { workspaceId, coaTagId: id, status: 'PENDING' }, data: { coaTag: name } });
        }
        return row;
      });
      await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `COA ${tag.payCategory.name} · ${updated.name}`, {
        action: 'coa.updated',
        coaTagId: id,
        changes: dto,
        ...(name !== undefined && name !== tag.name && { renamedFrom: tag.name }),
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A COA tag with this name already exists in this category');
      }
      throw error;
    }
  }

  async usage(workspaceId: string, coaTagId: string, client: Client = this.prisma) {
    const [queueItems, batchItems, requisitions, recurringPayments, stockExpenses, budgets] = await Promise.all([
      client.queueItem.count({ where: { workspaceId, coaTagId } }),
      client.batchItem.count({ where: { coaTagId } }),
      client.requisition.count({ where: { workspaceId, coaTagId } }),
      client.recurringPayment.count({ where: { workspaceId, coaTagId } }),
      client.stockExpense.count({ where: { workspaceId, coaTagId } }),
      client.budget.count({ where: { workspaceId, coaTagId } }),
    ]);
    const counts = { queueItems, batchItems, requisitions, recurringPayments, stockExpenses, budgets };
    return { counts, inUse: Object.values(counts).some((n) => n > 0) };
  }

  async remove(workspaceId: string, id: string, actor?: AuditActor) {
    const tag = await this.findTag(workspaceId, id);
    const { counts, inUse } = await this.usage(workspaceId, id);
    if (inUse) {
      throw new ConflictException({ message: `"${tag.name}" is in use and can't be deleted. Turn it off instead.`, usage: counts });
    }
    await this.prisma.coaTag.delete({ where: { id } });
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `COA ${tag.payCategory.name} · ${tag.name}`, { action: 'coa.deleted', coaTagId: id });
    return { success: true };
  }

  async templateCsv(workspaceId: string, payCategoryId?: string) {
    let examples = ['Fuel & Lubricants', 'Repairs & Maintenance', 'Telephone & Internet'];
    let fileName = 'coa-tags-template.csv';
    if (payCategoryId) {
      const cat = await this.category(workspaceId, payCategoryId);
      fileName = `coa-tags-${cat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-template.csv`;
      const tags = await this.prisma.coaTag.findMany({ where: { payCategoryId, isActive: true }, orderBy: { sortOrder: 'asc' }, take: 50 });
      if (tags.length) examples = tags.map((t) => t.name);
    }
    return { fileName, csv: toCsv(['coa_tag'], examples.map((e) => [e])) };
  }

  async importCsv(workspaceId: string, dto: ImportCoaTagsDto, actor?: AuditActor) {
    const cat = await this.category(workspaceId, dto.payCategoryId);
    const rows = parseCsvRows(dto.csv);
    if (rows.length && ['coatag', 'coa', 'name', 'tag', 'coatags', 'account'].includes(normalizeCsvHeader(rows[0][0]))) rows.shift();
    const names = rows.map((r) => (r[0] ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!names.length) throw new BadRequestException('No COA tags found in the CSV');

    const created: string[] = [];
    const reactivated: string[] = [];
    const skipped: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.coaTag.findMany({ where: { payCategoryId: cat.id } });
      const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]));
      let sort = existing.reduce((m, t) => Math.max(m, t.sortOrder), -1) + 1;
      for (const name of names) {
        const key = name.toLowerCase();
        const hit = byName.get(key);
        if (hit?.isActive || created.some((c) => c.toLowerCase() === key)) {
          skipped.push(name);
        } else if (hit) {
          await tx.coaTag.update({ where: { id: hit.id }, data: { isActive: true } });
          reactivated.push(hit.name);
        } else {
          await tx.coaTag.create({ data: { workspaceId, payCategoryId: cat.id, name: name.slice(0, 120), sortOrder: sort++ } });
          created.push(name);
        }
      }
    });
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `COA ${cat.name}`, {
      action: 'coa.csv_imported',
      created: created.length,
      reactivated: reactivated.length,
      skipped: skipped.length,
    });
    return { created, reactivated, skipped };
  }

  async previewDefaults(workspaceId: string, industry?: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { industry: true } });
    const set = coaDefaultsForIndustry(industry ?? ws?.industry);
    const existing = await this.existingDefaultCounts(workspaceId);
    return { ...set, existing, requiresConfirmation: Object.values(existing).some((n) => n > 0) };
  }

  private async existingDefaultCounts(workspaceId: string, client: Client = this.prisma) {
    const out: Record<string, number> = {};
    for (const bucket of Object.keys(DEFAULT_CATEGORY_META)) {
      out[bucket] = await client.coaTag.count({
        where: { workspaceId, isActive: true, payCategory: { name: { equals: bucket, mode: 'insensitive' } } },
      });
    }
    return out;
  }

  /**
   * One-click default setup: ensures COS / OPEX / ASSET exist and gives them 6 / 10 / 6
   * industry-tailored tags. Existing tags in those categories are replaced ONLY when
   * confirmReplace is true (unused ones are deleted; ones referenced by history are turned off).
   */
  async applyDefaults(workspaceId: string, dto: DefaultSetupDto, actor?: AuditActor) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { industry: true } });
    const industry = dto.industry?.trim() || ws?.industry || null;
    const set = coaDefaultsForIndustry(industry);
    const existing = await this.existingDefaultCounts(workspaceId);
    if (Object.values(existing).some((n) => n > 0) && !dto.confirmReplace) {
      throw new ConflictException({
        message: 'COA tags already exist in COS / OPEX / ASSET. Confirm to replace them with the defaults.',
        requiresConfirmation: true,
        existing,
        preview: set,
      });
    }

    const summary = await this.prisma.$transaction(
      async (tx) => {
        if (dto.industry?.trim()) await tx.workspace.update({ where: { id: workspaceId }, data: { industry: dto.industry.trim() } });
        const result: Record<string, { categoryId: string; createdCategory: boolean; tags: string[]; removed: number; deactivated: number }> = {};
        for (const bucket of ['OPEX', 'COS', 'ASSET'] as const) {
          const meta = DEFAULT_CATEGORY_META[bucket];
          let cat = await tx.payCategory.findFirst({ where: { workspaceId, name: { equals: bucket, mode: 'insensitive' } } });
          const createdCategory = !cat;
          if (!cat) {
            cat = await tx.payCategory.create({ data: { workspaceId, name: bucket, color: meta.color, includeInBudgets: meta.includeInBudgets, sortOrder: meta.sortOrder } });
          } else if (!cat.isActive) {
            cat = await tx.payCategory.update({ where: { id: cat.id }, data: { isActive: true } });
          }
          const wanted = set[bucket];
          const wantedLower = new Set(wanted.map((w) => w.toLowerCase()));
          const current = await tx.coaTag.findMany({ where: { payCategoryId: cat.id } });
          let removed = 0;
          let deactivated = 0;
          for (const t of current) {
            if (wantedLower.has(t.name.toLowerCase())) continue;
            const { inUse } = await this.usage(workspaceId, t.id, tx);
            if (inUse) {
              if (t.isActive) {
                await tx.coaTag.update({ where: { id: t.id }, data: { isActive: false } });
                deactivated++;
              }
            } else {
              await tx.coaTag.delete({ where: { id: t.id } });
              removed++;
            }
          }
          for (const [idx, name] of wanted.entries()) {
            const hit = current.find((t) => t.name.toLowerCase() === name.toLowerCase());
            if (hit) await tx.coaTag.update({ where: { id: hit.id }, data: { isActive: true, sortOrder: idx } });
            else await tx.coaTag.create({ data: { workspaceId, payCategoryId: cat.id, name, sortOrder: idx } });
          }
          result[bucket] = { categoryId: cat.id, createdCategory, tags: wanted, removed, deactivated };
        }
        for (const key of ['setup_categories_done', 'setup_coa_done']) {
          await tx.appConfig.upsert({
            where: { workspaceId_key: { workspaceId, key } },
            create: { workspaceId, key, value: true },
            update: { value: true },
          });
        }
        return result;
      },
      { timeout: 30_000 },
    );

    for (const [bucket, r] of Object.entries(summary)) {
      if (r.createdCategory) {
        await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CATEGORY_CREATED, bucket, { id: r.categoryId, via: 'coa.default_setup' }, { type: 'pay_category', id: r.categoryId });
      }
    }
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, 'COA default setup', { action: 'coa.default_setup', industry: set.industry, summary });
    return { industry: set.industry, categories: summary };
  }

  async suggest(workspaceId: string, dto: SuggestCoaTagsDto) {
    const cat = await this.category(workspaceId, dto.payCategoryId);
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { industry: true } });
    const existing = await this.prisma.coaTag.findMany({ where: { payCategoryId: cat.id, isActive: true }, select: { name: true } });
    const result = await this.ai.suggestCoaTags({
      categoryName: cat.name,
      industry: dto.industry ?? ws?.industry,
      existing: existing.map((e) => e.name),
      limit: dto.limit,
    });
    return { payCategoryId: cat.id, payCategoryName: cat.name, ...result };
  }
}
