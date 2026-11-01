import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MonnifyService } from '../monnify/monnify.service';
import { AuditActor, AuditLogService } from '../platform/audit-log.service';
import { AUDIT_ACTIONS, bankNameForCode, paginate } from '../../common';
import { ResolveWhtDto, SeedWhtDefaultsDto, UpdateWhtAccountDto, UpdateWhtRateDto, UpsertWhtRateDto, WhtLedgerQueryDto } from './dto';
import { WHT_ACCOUNT_KEYS, WHT_STATUTORY_DEFAULTS, WhtAccount } from './wht-defaults';

function toNumber(val: Prisma.Decimal | number | null | undefined): number {
  if (val === null || val === undefined) return 0;
  return typeof val === 'number' ? val : Number(val);
}

const FIVE_PERCENT_KEYWORDS = [
  'professional', 'consult', 'legal', 'audit', 'accountancy', 'management fee', 'technical',
  'commission', 'transport', 'haulage', 'agency', 'agent',
];
const TWO_PERCENT_KEYWORDS = ['supply', 'supplies', 'contract', 'construction', 'building', 'procure'];

export interface WhtResolution {
  rate: number; // fraction 0–1
  source: 'vendor_exempt' | 'vendor_override' | 'workspace_default' | 'keyword' | 'none';
  label: string;
}

export interface WhtAmounts {
  gross: number;
  wht: number;
  net: number;
}

/** Spec §6 maths: gross = round(total), wht = round(gross × rate), net = max(0, gross − wht). */
export function computeWht(total: number, rate: number): WhtAmounts {
  const gross = Math.round(total);
  const wht = Math.round(gross * rate);
  return { gross, wht, net: Math.max(0, gross - wht) };
}

/** Spec §6 step 4: keyword heuristic on the COA name. */
export function keywordWhtRate(coa: string | null | undefined): number {
  const name = (coa ?? '').toLowerCase();
  if (!name) return 0;
  if (FIVE_PERCENT_KEYWORDS.some((k) => name.includes(k))) return 0.05;
  if (TWO_PERCENT_KEYWORDS.some((k) => name.includes(k))) return 0.02;
  return 0;
}

@Injectable()
export class WhtService {
  private readonly logger = new Logger(WhtService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly monnify: MonnifyService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Spec §6 resolution order: vendor exempt → vendor override (>0) → workspace wht_rates entry
   * matching the COA (case-insensitive) → keyword heuristic → 0.
   */
  async resolveRate(
    workspaceId: string,
    params: { vendorId?: string | null; vendor?: { whtExempt: boolean; whtRate: Prisma.Decimal | number | null } | null; coa?: string | null },
  ): Promise<WhtResolution> {
    let vendor = params.vendor ?? null;
    if (!vendor && params.vendorId) {
      vendor = await this.prisma.vendor.findFirst({
        where: { id: params.vendorId, workspaceId },
        select: { whtExempt: true, whtRate: true },
      });
    }
    if (vendor?.whtExempt) return { rate: 0, source: 'vendor_exempt', label: 'Vendor is marked WHT-exempt' };
    const vendorRate = toNumber(vendor?.whtRate);
    if (vendorRate > 0) return { rate: vendorRate, source: 'vendor_override', label: 'Vendor-level override' };

    const coa = params.coa?.trim();
    if (coa) {
      const row = await this.prisma.whtRate.findFirst({
        where: { workspaceId, coa: { equals: coa, mode: 'insensitive' } },
      });
      if (row) return { rate: toNumber(row.rate), source: 'workspace_default', label: `Workspace default for ${row.coa}` };

      const kw = keywordWhtRate(coa);
      if (kw > 0) return { rate: kw, source: 'keyword', label: `Workspace default for ${coa}` };
    }
    return { rate: 0, source: 'none', label: 'No WHT applies' };
  }

  async listRates(workspaceId: string) {
    return this.prisma.whtRate.findMany({ where: { workspaceId }, orderBy: { coa: 'asc' } });
  }

  async upsertRate(workspaceId: string, dto: UpsertWhtRateDto, actor?: AuditActor) {
    const coa = dto.coa.trim();
    const existing = await this.prisma.whtRate.findFirst({
      where: { workspaceId, coa: { equals: coa, mode: 'insensitive' } },
    });
    const row = existing
      ? await this.prisma.whtRate.update({ where: { id: existing.id }, data: { rate: dto.rate, label: dto.label } })
      : await this.prisma.whtRate.create({ data: { workspaceId, coa, rate: dto.rate, label: dto.label } });
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `WHT rate ${row.coa}`, { action: 'wht_rate.upserted', rate: dto.rate, label: dto.label });
    return row;
  }

  async updateRate(workspaceId: string, id: string, dto: UpdateWhtRateDto, actor?: AuditActor) {
    const existing = await this.prisma.whtRate.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException('WHT rate not found');
    try {
      const row = await this.prisma.whtRate.update({
        where: { id },
        data: {
          ...(dto.coa !== undefined && { coa: dto.coa.trim() }),
          ...(dto.rate !== undefined && { rate: dto.rate }),
          ...(dto.label !== undefined && { label: dto.label }),
        },
      });
      await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `WHT rate ${row.coa}`, { action: 'wht_rate.updated', changes: dto });
      return row;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A WHT rate for this COA already exists');
      }
      throw error;
    }
  }

  async removeRate(workspaceId: string, id: string, actor?: AuditActor) {
    const existing = await this.prisma.whtRate.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException('WHT rate not found');
    await this.prisma.whtRate.delete({ where: { id: existing.id } });
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, `WHT rate ${existing.coa}`, { action: 'wht_rate.deleted' });
    return { success: true };
  }

  /** Seed the Nigerian statutory defaults (missing COAs only unless overwrite). */
  async seedDefaults(workspaceId: string, dto: SeedWhtDefaultsDto, actor?: AuditActor) {
    const existing = await this.prisma.whtRate.findMany({ where: { workspaceId } });
    const byCoa = new Map(existing.map((r) => [r.coa.toLowerCase(), r]));
    let created = 0;
    let updated = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const d of WHT_STATUTORY_DEFAULTS) {
        const hit = byCoa.get(d.coa.toLowerCase());
        if (!hit) {
          await tx.whtRate.create({ data: { workspaceId, coa: d.coa, rate: d.rate, label: d.label } });
          created++;
        } else if (dto.overwrite) {
          await tx.whtRate.update({ where: { id: hit.id }, data: { rate: d.rate, label: d.label } });
          updated++;
        }
      }
    });
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, 'WHT statutory defaults', { action: 'wht_rate.seeded', created, updated });
    return { created, updated, rates: await this.listRates(workspaceId) };
  }

  statutoryDefaults() {
    return WHT_STATUTORY_DEFAULTS;
  }

  /** Preview endpoint: resolved rate (+ maths when a total is given). */
  async resolve(workspaceId: string, dto: ResolveWhtDto) {
    if (dto.vendorId) {
      const v = await this.prisma.vendor.findFirst({ where: { id: dto.vendorId, workspaceId }, select: { id: true } });
      if (!v) throw new NotFoundException('Vendor not found');
    }
    const resolution = await this.resolveRate(workspaceId, { vendorId: dto.vendorId, coa: dto.coa });
    return { ...resolution, ...(dto.total !== undefined && { amounts: computeWht(dto.total, resolution.rate) }) };
  }

  // ── WHT destination account (AppConfig wht_account_*) ──────────────────────────────────────

  async getAccount(workspaceId: string): Promise<WhtAccount> {
    const rows = await this.prisma.appConfig.findMany({
      where: { workspaceId, key: { in: Object.values(WHT_ACCOUNT_KEYS) } },
    });
    const get = (k: string) => {
      const v = rows.find((r) => r.key === k)?.value;
      return v === undefined || v === null ? null : v;
    };
    const str = (k: string) => {
      const v = get(k);
      return v === null ? null : String(v);
    };
    const accountNumber = str(WHT_ACCOUNT_KEYS.accountNumber);
    const bankCode = str(WHT_ACCOUNT_KEYS.bankCode);
    return {
      bankCode,
      bankName: str(WHT_ACCOUNT_KEYS.bankName),
      accountNumber,
      accountName: str(WHT_ACCOUNT_KEYS.accountName),
      verified: get(WHT_ACCOUNT_KEYS.verified) === true,
      verifiedAt: str(WHT_ACCOUNT_KEYS.verifiedAt),
      configured: !!(accountNumber && bankCode),
    };
  }

  async updateAccount(workspaceId: string, dto: UpdateWhtAccountDto, actor?: { id: string; email?: string | null }) {
    const bankName = bankNameForCode(dto.bankCode) ?? (await this.monnify.listBanks()).find((b) => b.code === dto.bankCode)?.name ?? null;
    let accountName: string | null = null;
    let verified = false;
    try {
      const result = await this.monnify.verifyBankAccount(dto.accountNumber, dto.bankCode);
      accountName = result.accountName;
      verified = !!accountName;
    } catch (error) {
      this.logger.warn(`WHT account name enquiry failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    if (!verified) {
      if (!dto.allowUnverified || !dto.accountName?.trim()) {
        throw new BadRequestException("The bank couldn't confirm this account. Tick \"save with manual name\" and type the account name to continue.");
      }
      accountName = dto.accountName.trim();
    }
    const values: Record<string, Prisma.InputJsonValue> = {
      [WHT_ACCOUNT_KEYS.bankCode]: dto.bankCode,
      [WHT_ACCOUNT_KEYS.bankName]: bankName ?? dto.bankCode,
      [WHT_ACCOUNT_KEYS.accountNumber]: dto.accountNumber,
      [WHT_ACCOUNT_KEYS.accountName]: accountName as string,
      [WHT_ACCOUNT_KEYS.verified]: verified,
      [WHT_ACCOUNT_KEYS.verifiedAt]: verified ? new Date().toISOString() : '',
    };
    const updatedById = actor?.id;
    await this.prisma.$transaction(
      Object.entries(values).map(([key, value]) =>
        this.prisma.appConfig.upsert({
          where: { workspaceId_key: { workspaceId, key } },
          create: { workspaceId, key, value, updatedById },
          update: { value, updatedById },
        }),
      ),
    );
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, 'WHT destination account', {
      keys: Object.keys(values),
      bankCode: dto.bankCode,
      accountNumber: dto.accountNumber,
      verified,
    });
    return this.getAccount(workspaceId);
  }

  async clearAccount(workspaceId: string, actor?: AuditActor) {
    await this.prisma.appConfig.deleteMany({ where: { workspaceId, key: { in: Object.values(WHT_ACCOUNT_KEYS) } } });
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, 'WHT destination account', { action: 'wht_account.cleared' });
    return this.getAccount(workspaceId);
  }

  async listLedger(workspaceId: string, query: WhtLedgerQueryDto) {
    const { page = 1, limit = 20, taxPeriod } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.WhtLedgerWhereInput = {
      workspaceId,
      ...(taxPeriod && { taxPeriod }),
    };

    const [entries, total] = await Promise.all([
      this.prisma.whtLedger.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { vendor: { select: { id: true, name: true, tin: true } } },
      }),
      this.prisma.whtLedger.count({ where }),
    ]);

    return paginate(entries, total, page, limit);
  }
}
