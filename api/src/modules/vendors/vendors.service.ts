import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Vendor } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditActor, AuditLogService } from '../platform/audit-log.service';
import {
  AUDIT_ACTIONS,
  NIGERIAN_BANKS,
  NigerianBank,
  paginate,
  parseCsvRecords,
  resolveBank,
  toCsv,
} from '../../common';
import { MonnifyService } from '../monnify/monnify.service';
import {
  BulkVendorPreviewRow,
  CreateVendorDto,
  UpdateVendorDto,
  VendorQueryDto,
  VerifyAccountDto,
} from './dto';
import { namesMatch } from './vendor-name-match';
import { renderVendorPdf, VENDOR_EXPORT_HEADER } from './vendor-pdf';

export interface NameEnquiryResult {
  verified: boolean;
  accountName: string | null;
  accountNumber: string;
  bankCode: string;
  bankName: string | null;
  reason?: string;
}

const BULK_MAX_ROWS = 500;
const VERIFY_CONCURRENCY = 5;

function cleanTags(tags: string[] | undefined | null): string[] {
  const out: string[] = [];
  for (const t of tags ?? []) {
    const v = t.replace(/\s+/g, ' ').trim();
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly monnifyService: MonnifyService,
    private readonly audit: AuditLogService,
  ) {}

  // ── Banks & name enquiry ──────────────────────────────────────────────────────────────────

  /** ~45 Nigerian banks with CBN/NIP codes, merged with Monnify's live list when not in mock mode. */
  async listBanks(): Promise<NigerianBank[]> {
    const banks = NIGERIAN_BANKS.map((b) => ({ ...b }));
    try {
      const live = await this.monnifyService.listBanks();
      for (const b of live) if (!banks.some((x) => x.code === b.code)) banks.push({ name: b.name, code: b.code });
    } catch {
      /* static list is enough */
    }
    return banks;
  }

  private async bankFor(code: string): Promise<NigerianBank | undefined> {
    return (await this.listBanks()).find((b) => b.code === code);
  }

  /** Name enquiry via Monnify validate-account. Never throws for a bank-side failure. */
  async nameEnquiry(accountNumber: string, bankCode: string): Promise<NameEnquiryResult> {
    const bank = await this.bankFor(bankCode);
    const base = { accountNumber, bankCode, bankName: bank?.name ?? null };
    if (!/^\d{10}$/.test(accountNumber)) return { ...base, verified: false, accountName: null, reason: 'Account number must be 10 digits' };
    if (!bank) return { ...base, verified: false, accountName: null, reason: 'No bank code mapped — payouts will fail for this vendor' };
    try {
      const r = await this.monnifyService.verifyBankAccount(accountNumber, bankCode);
      if (!r.accountName) return { ...base, verified: false, accountName: null, reason: 'Bank returned no account name' };
      return { ...base, verified: true, accountName: r.accountName };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Bank could not confirm this account';
      this.logger.warn(`Name enquiry failed for ${bankCode}/${accountNumber.slice(-4)}: ${reason}`);
      return { ...base, verified: false, accountName: null, reason: `Bank could not confirm this account (${reason})` };
    }
  }

  async verifyAccount(dto: VerifyAccountDto) {
    return this.nameEnquiry(dto.accountNumber, dto.bankCode);
  }

  /**
   * Bank fields for a create/update. Verified → name from the bank. Not verified → only allowed
   * with the "save with manual name" tick-box and a typed name.
   */
  private async bankFields(input: {
    bankCode?: string | null;
    bankAccountNumber?: string | null;
    accountName?: string | null;
    allowUnverified?: boolean;
  }): Promise<Prisma.VendorUncheckedUpdateInput> {
    const code = input.bankCode?.trim() || null;
    const acct = input.bankAccountNumber?.trim() || null;
    if (!code && !acct) {
      return { bankCode: null, bankAccountNumber: null, bankName: null, accountName: input.accountName?.trim() || null, verifiedAccountName: null, verifiedAt: null, isBankVerified: false };
    }
    if (!code || !acct) throw new BadRequestException('Pick a bank and enter the 10-digit account number');
    const r = await this.nameEnquiry(acct, code);
    if (!r.bankName) throw new BadRequestException(r.reason ?? 'Unknown bank code');
    if (r.verified) {
      return { bankCode: code, bankAccountNumber: acct, bankName: r.bankName, accountName: r.accountName, verifiedAccountName: r.accountName, verifiedAt: new Date(), isBankVerified: true };
    }
    if (!input.allowUnverified || !input.accountName?.trim()) {
      throw new BadRequestException({
        message: `${r.reason ?? "The bank couldn't confirm this account"}. Tick "save with the name I typed" and enter the account name to continue.`,
        code: 'BANK_UNVERIFIED',
      });
    }
    return { bankCode: code, bankAccountNumber: acct, bankName: r.bankName, accountName: input.accountName.trim(), verifiedAccountName: null, verifiedAt: null, isBankVerified: false };
  }

  // ── Read ──────────────────────────────────────────────────────────────────────────────────

  private searchWhere(workspaceId: string, query: { search?: string; tag?: string; includeInactive?: boolean }): Prisma.VendorWhereInput {
    const s = query.search?.trim();
    return {
      workspaceId,
      ...(!query.includeInactive && { isActive: true }),
      ...(query.tag && { tags: { has: query.tag } }),
      ...(s && {
        OR: [
          { name: { contains: s, mode: 'insensitive' } },
          { bankName: { contains: s, mode: 'insensitive' } },
          { bankAccountNumber: { contains: s } },
          { contactPerson: { contains: s, mode: 'insensitive' } },
          { verifiedAccountName: { contains: s, mode: 'insensitive' } },
          { tin: { contains: s, mode: 'insensitive' } },
          { tags: { has: s } },
          { tags: { hasSome: [s.toLowerCase(), s.toUpperCase(), s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()] } },
        ],
      }),
    };
  }

  async list(workspaceId: string, query: VendorQueryDto) {
    const { page = 1, limit = 20 } = query;
    const where = this.searchWhere(workspaceId, query);
    const [vendors, total, all] = await Promise.all([
      this.prisma.vendor.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { name: 'asc' } }),
      this.prisma.vendor.count({ where }),
      this.prisma.vendor.count({ where: { workspaceId, isActive: true } }),
    ]);
    // meta.total = matches ("N of N vendors" uses totalVendors as the second N)
    return { ...paginate(vendors, total, page, limit), totalVendors: all };
  }

  /** Tag chips: every tag with its vendor count, most used first. */
  async tags(workspaceId: string) {
    const rows = await this.prisma.vendor.findMany({ where: { workspaceId, isActive: true }, select: { tags: true } });
    const counts = new Map<string, number>();
    for (const r of rows) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /** "No TIN / phone" — vendors to chase before paying. */
  async missingInfo(workspaceId: string) {
    const vendors = await this.prisma.vendor.findMany({
      where: {
        workspaceId,
        isActive: true,
        OR: [{ tin: null }, { tin: '' }, { phone: null }, { phone: '' }],
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, tin: true, phone: true, contactPerson: true, bankName: true, bankAccountNumber: true },
    });
    return {
      count: vendors.length,
      vendors: vendors.map((v) => ({ ...v, missingTin: !v.tin?.trim(), missingPhone: !v.phone?.trim() })),
    };
  }

  async findOne(workspaceId: string, id: string) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id, workspaceId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  // ── Write ─────────────────────────────────────────────────────────────────────────────────

  private conflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('A vendor with this name already exists');
    }
    throw error;
  }

  async create(workspaceId: string, dto: CreateVendorDto, actor?: AuditActor) {
    const bank = await this.bankFields(dto);
    try {
      const vendor = await this.prisma.vendor.create({
        data: {
          ...(bank as Prisma.VendorUncheckedCreateInput),
          workspaceId,
          name: dto.name.trim(),
          contactPerson: dto.contactPerson || null,
          phone: dto.phone || null,
          email: dto.email || null,
          tin: dto.tin || null,
          tags: cleanTags(dto.tags),
          whtExempt: dto.whtExempt ?? false,
          whtRate: dto.whtRate ? dto.whtRate : null,
          isActive: dto.isActive ?? true,
        },
      });
      await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.VENDOR_CREATED, vendor.name, {
        vendorId: vendor.id,
        bank: vendor.bankName,
        verified: vendor.isBankVerified,
      }, { type: 'vendor', id: vendor.id });
      return vendor;
    } catch (error) {
      this.conflict(error);
    }
  }

  async update(workspaceId: string, id: string, dto: UpdateVendorDto, actor?: AuditActor) {
    const existing = await this.findOne(workspaceId, id);
    const nextCode = dto.bankCode !== undefined ? dto.bankCode : existing.bankCode;
    const nextAcct = dto.bankAccountNumber !== undefined ? dto.bankAccountNumber : existing.bankAccountNumber;
    const bankChanged = nextCode !== existing.bankCode || nextAcct !== existing.bankAccountNumber;
    const manualNameChange = !bankChanged && dto.allowUnverified && dto.accountName !== undefined && !existing.isBankVerified;

    let bank: Prisma.VendorUncheckedUpdateInput = {};
    if (bankChanged) {
      bank = await this.bankFields({ bankCode: nextCode, bankAccountNumber: nextAcct, accountName: dto.accountName, allowUnverified: dto.allowUnverified });
    } else if (manualNameChange) {
      bank = { accountName: dto.accountName?.trim() || null };
    }

    const data: Prisma.VendorUncheckedUpdateInput = {
      ...bank,
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.contactPerson !== undefined && { contactPerson: dto.contactPerson || null }),
      ...(dto.phone !== undefined && { phone: dto.phone || null }),
      ...(dto.email !== undefined && { email: dto.email || null }),
      ...(dto.tin !== undefined && { tin: dto.tin || null }),
      ...(dto.tags !== undefined && { tags: cleanTags(dto.tags) }),
      ...(dto.whtExempt !== undefined && { whtExempt: dto.whtExempt }),
      ...(dto.whtRate !== undefined && { whtRate: dto.whtRate ? dto.whtRate : null }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
    try {
      const vendor = await this.prisma.vendor.update({ where: { id }, data });
      const changed = Object.keys(data).filter((k) => {
        const before = (existing as Record<string, unknown>)[k];
        const after = (vendor as Record<string, unknown>)[k];
        return JSON.stringify(before) !== JSON.stringify(after);
      });
      await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.VENDOR_UPDATED, vendor.name, { vendorId: id, changed, bankChanged }, { type: 'vendor', id });
      return vendor;
    } catch (error) {
      this.conflict(error);
    }
  }

  /** Re-run the name enquiry for a saved vendor ("Re-check"). */
  async recheck(workspaceId: string, id: string, actor?: AuditActor) {
    const v = await this.findOne(workspaceId, id);
    if (!v.bankCode || !v.bankAccountNumber) throw new BadRequestException('This vendor has no bank details');
    const r = await this.nameEnquiry(v.bankAccountNumber, v.bankCode);
    if (!r.verified) return { verified: false, reason: r.reason, vendor: v };
    const vendor = await this.prisma.vendor.update({
      where: { id },
      data: { verifiedAccountName: r.accountName, accountName: r.accountName, verifiedAt: new Date(), isBankVerified: true, bankName: r.bankName ?? v.bankName },
    });
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.VENDOR_UPDATED, vendor.name, { vendorId: id, changed: ['verifiedAccountName'], via: 'recheck' }, { type: 'vendor', id });
    return { verified: true, vendor };
  }

  /** Admin delete: hard-delete if the vendor was never used, otherwise deactivate (history stays intact). */
  async remove(workspaceId: string, id: string, actor?: AuditActor) {
    const v = await this.findOne(workspaceId, id);
    const [q, b, r, rp] = await Promise.all([
      this.prisma.queueItem.count({ where: { workspaceId, vendorId: id } }),
      this.prisma.batchItem.count({ where: { vendorId: id } }),
      this.prisma.requisition.count({ where: { workspaceId, vendorId: id } }),
      this.prisma.recurringPayment.count({ where: { workspaceId, vendorId: id } }),
    ]);
    const inUse = q + b + r + rp > 0;
    if (inUse) await this.prisma.vendor.update({ where: { id }, data: { isActive: false } });
    else await this.prisma.vendor.delete({ where: { id } });
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.VENDOR_DELETED, v.name, { vendorId: id, deactivated: inUse }, { type: 'vendor', id });
    return { success: true, deactivated: inUse };
  }

  // ── Export ────────────────────────────────────────────────────────────────────────────────

  private exportRow(v: Vendor): string[] {
    return [v.name, v.bankName ?? '', v.bankAccountNumber ?? '', v.verifiedAccountName ?? '', v.contactPerson ?? '', v.phone ?? '', v.tin ?? '', v.tags.join('; ')];
  }

  private async exportVendors(workspaceId: string, query: { search?: string; tag?: string }) {
    return this.prisma.vendor.findMany({ where: this.searchWhere(workspaceId, query), orderBy: { name: 'asc' } });
  }

  async exportCsv(workspaceId: string, query: { search?: string; tag?: string } = {}) {
    const vendors = await this.exportVendors(workspaceId, query);
    return toCsv(VENDOR_EXPORT_HEADER, vendors.map((v) => this.exportRow(v)));
  }

  async exportPdf(workspaceId: string, query: { search?: string; tag?: string } = {}) {
    const [ws, vendors] = await Promise.all([
      this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
      this.exportVendors(workspaceId, query),
    ]);
    return renderVendorPdf(ws?.name ?? 'Paid in Full', vendors.map((v) => this.exportRow(v)));
  }

  templateCsv() {
    return toCsv(
      ['name', 'bank', 'account_number', 'contact_name', 'phone', 'tin', 'tags'],
      [
        ['Adebayo Provisions Ltd', 'GTBank', '0123456789', 'Adebayo Musa', '08031234567', '12345678-0001', 'provisions; kitchen'],
        ['Chioma Okafor', '058', '0987654321', '', '08098765432', '', 'staff'],
      ],
    );
  }

  // ── Bulk CSV upload ──────────────────────────────────────────────────────────────────────

  /**
   * Parses + verifies every row with the bank. Only rows whose typed name (account_name column
   * if present, else name) matches the bank's name are importable.
   */
  async bulkPreview(workspaceId: string, csv: string) {
    const { records } = parseCsvRecords(csv, {
      name: ['vendor', 'vendorname', 'name', 'typedname', 'vendortyped'],
      accountName: ['accountname', 'acctname', 'nameonaccount'],
      bank: ['bank', 'bankname', 'bankcode'],
      accountNumber: ['accountnumber', 'accountno', 'acctno', 'account', 'nuban', 'acctnumber'],
      contactName: ['contactname', 'contact', 'contactperson'],
      phone: ['phone', 'contactphone', 'phonenumber', 'mobile'],
      tin: ['tin', 'taxid', 'firstin'],
      tags: ['tags', 'tag'],
      email: ['email', 'emailaddress'],
    });
    if (!records.length) throw new BadRequestException('The CSV has no vendor rows (a header row is required)');
    if (records.length > BULK_MAX_ROWS) throw new BadRequestException(`Upload at most ${BULK_MAX_ROWS} vendors at a time`);

    const banks = await this.listBanks();
    const existing = await this.prisma.vendor.findMany({ where: { workspaceId }, select: { name: true, bankCode: true, bankAccountNumber: true } });
    const existingNames = new Set(existing.map((e) => e.name.toLowerCase()));
    const existingAccts = new Set(existing.filter((e) => e.bankAccountNumber).map((e) => `${e.bankCode}|${e.bankAccountNumber}`));
    const seenNames = new Set<string>();
    const seenAccts = new Set<string>();

    const rows: Array<BulkVendorPreviewRow & { email: string | null; typedAccountName: string | null }> = records.map((r) => {
      const name = (r.name ?? '').replace(/\s+/g, ' ').trim();
      const accountNumber = (r.accountNumber ?? '').replace(/\D/g, '');
      const bank = resolveBank(r.bank, banks);
      const row = {
        row: r._row,
        status: 'ready' as BulkVendorPreviewRow['status'],
        importable: false,
        name,
        bankInput: r.bank ?? '',
        bankCode: bank?.code ?? null,
        bankName: bank?.name ?? null,
        accountNumber,
        contactName: r.contactName ?? null,
        phone: r.phone ?? null,
        tin: r.tin ?? null,
        tags: cleanTags((r.tags ?? '').split(/[;|]/)),
        email: r.email ?? null,
        typedAccountName: r.accountName ?? null,
        bankAccountName: null,
        reason: '',
      };
      const acctKey = `${row.bankCode}|${accountNumber}`;
      if (!name) Object.assign(row, { status: 'invalid', reason: 'Vendor name is missing' });
      else if (!bank) Object.assign(row, { status: 'invalid', reason: r.bank ? `Unknown bank "${r.bank}"` : 'Bank is missing' });
      else if (!/^\d{10}$/.test(accountNumber)) Object.assign(row, { status: 'invalid', reason: 'Account number must be 10 digits' });
      else if (existingNames.has(name.toLowerCase())) Object.assign(row, { status: 'duplicate', reason: 'A vendor with this name already exists' });
      else if (existingAccts.has(acctKey)) Object.assign(row, { status: 'duplicate', reason: 'This bank account is already registered' });
      else if (seenNames.has(name.toLowerCase()) || seenAccts.has(acctKey)) Object.assign(row, { status: 'duplicate', reason: 'Duplicate row in this file' });
      seenNames.add(name.toLowerCase());
      seenAccts.add(acctKey);
      return row;
    });

    const toVerify = rows.filter((r) => r.status === 'ready');
    for (let i = 0; i < toVerify.length; i += VERIFY_CONCURRENCY) {
      await Promise.all(
        toVerify.slice(i, i + VERIFY_CONCURRENCY).map(async (row) => {
          const res = await this.nameEnquiry(row.accountNumber, row.bankCode as string);
          if (!res.verified) {
            Object.assign(row, { status: 'unverified', reason: res.reason ?? 'Bank could not confirm this account' });
            return;
          }
          row.bankAccountName = res.accountName;
          const typed = row.typedAccountName || row.name;
          if (namesMatch(typed, res.accountName as string)) {
            Object.assign(row, { status: 'ready', importable: true, reason: 'Name matches bank' });
          } else {
            Object.assign(row, { status: 'mismatch', reason: `Typed name doesn't match the bank's name (${res.accountName})` });
          }
        }),
      );
    }

    const summary = {
      total: rows.length,
      ready: rows.filter((r) => r.importable).length,
      mismatch: rows.filter((r) => r.status === 'mismatch').length,
      unverified: rows.filter((r) => r.status === 'unverified').length,
      invalid: rows.filter((r) => r.status === 'invalid').length,
      duplicate: rows.filter((r) => r.status === 'duplicate').length,
    };
    return { summary, rows };
  }

  /** Re-verifies server-side (never trusts the client's preview) and imports matching rows only. */
  async bulkCommit(workspaceId: string, csv: string, actor?: AuditActor) {
    const preview = await this.bulkPreview(workspaceId, csv);
    const ready = preview.rows.filter((r) => r.importable);
    const created: { id: string; name: string; row: number }[] = [];
    const failed: { row: number; name: string; reason: string }[] = [];
    for (const r of ready) {
      try {
        const v = await this.prisma.vendor.create({
          data: {
            workspaceId,
            name: r.name,
            bankCode: r.bankCode,
            bankName: r.bankName,
            bankAccountNumber: r.accountNumber,
            accountName: r.bankAccountName,
            verifiedAccountName: r.bankAccountName,
            verifiedAt: new Date(),
            isBankVerified: true,
            contactPerson: r.contactName,
            phone: r.phone,
            email: r.email,
            tin: r.tin,
            tags: r.tags,
          },
        });
        created.push({ id: v.id, name: v.name, row: r.row });
        await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.VENDOR_CREATED, v.name, { vendorId: v.id, via: 'bulk_csv', bank: v.bankName, verified: true }, { type: 'vendor', id: v.id });
      } catch (error) {
        failed.push({
          row: r.row,
          name: r.name,
          reason: error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' ? 'A vendor with this name already exists' : 'Could not save',
        });
      }
    }
    const skipped = preview.rows.filter((r) => !r.importable).map((r) => ({ row: r.row, name: r.name, status: r.status, reason: r.reason }));
    return { created, failed, skipped, summary: { ...preview.summary, imported: created.length } };
  }
}
