import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Requisition, RequisitionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../platform/audit-log.service';
import {
  AUDIT_ACTIONS,
  CurrentUserData,
  Role,
  canProcure,
  isAdmin,
  paginate,
  validateDescription,
} from '../../common';
import {
  DbClient,
  NotifyBridge,
  QueueLineBuilder,
  readConfigFlag,
  round2,
  toDateOnly,
  toNum,
  vendorHasBankDetails,
} from '../queue/queue-core';
import { QueueAttachmentsService, UploadedFileLike } from '../queue/queue-attachments.service';
import {
  CreateRequisitionBundleDto,
  CreateRequisitionDto,
  PushToQueueDto,
  RequisitionFilter,
  RequisitionHeaderDto,
  RequisitionQueryDto,
  ReviewRequisitionDto,
  UpdateRequisitionDto,
} from './dto';

const FILTER_STATUSES: Record<RequisitionFilter, RequisitionStatus[] | null> = {
  open: ['DRAFT', 'SUBMITTED', 'RETURNED', 'PROCUREMENT_CLEARED'],
  draft: ['DRAFT'],
  submitted: ['SUBMITTED'],
  cleared: ['PROCUREMENT_CLEARED'],
  returned: ['RETURNED'],
  queued: ['QUEUED'],
  rejected: ['REJECTED'],
  all: null,
};

/** Statuses in which the requester can still edit / delete (before procurement clears it). */
const EDITABLE: RequisitionStatus[] = ['DRAFT', 'SUBMITTED', 'RETURNED'];

const DETAIL_INCLUDE = {
  vendor: true,
  department: true,
  payCategory: { select: { id: true, name: true, color: true } },
  coaTag: { select: { id: true, name: true } },
  costCenter: { select: { id: true, name: true, code: true } },
  location: { select: { id: true, name: true, isGeneral: true } },
  queueItem: { select: { id: true, status: true } },
  requestedBy: { select: { id: true, firstName: true, lastName: true, displayName: true, email: true } },
} satisfies Prisma.RequisitionInclude;

interface DescriptionIssue {
  id: string;
  description: string;
  issues: string[];
}

@Injectable()
export class RequisitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly lineBuilder: QueueLineBuilder,
    private readonly notifier: NotifyBridge,
    private readonly attachments: QueueAttachmentsService,
  ) {}

  // ─── helpers ───────────────────────────────────────────────────────────

  private async assertEnabled(workspaceId: string) {
    const enabled = await readConfigFlag(this.prisma, workspaceId, 'requisitions_enabled', true);
    if (!enabled) throw new ForbiddenException('Requisitions module is disabled');
  }

  /** Requesters (below procurement) only see their own requisitions. */
  private ownOnly(user: CurrentUserData): boolean {
    return !user.isPlatformAdmin && user.role === Role.REQUESTER;
  }

  private isOwner(req: Pick<Requisition, 'requestedById'>, user: CurrentUserData) {
    return req.requestedById === user.id;
  }

  private async load(workspaceId: string, id: string, user: CurrentUserData) {
    const req = await this.prisma.requisition.findFirst({ where: { id, workspaceId }, include: DETAIL_INCLUDE });
    if (!req) throw new NotFoundException('Requisition not found');
    if (this.ownOnly(user) && !this.isOwner(req, user)) throw new NotFoundException('Requisition not found');
    return req;
  }

  private assertCanEdit(req: Requisition, user: CurrentUserData) {
    if (!EDITABLE.includes(req.status)) {
      throw new ConflictException(`A ${req.status.toLowerCase()} requisition can no longer be edited`);
    }
    if (!this.isOwner(req, user) && !canProcure(user)) {
      throw new ForbiddenException('You can only edit your own requisitions');
    }
  }

  /** Bundle siblings (or just the one) for "wholeBundle" actions. */
  private async targets(workspaceId: string, req: Requisition, wholeBundle?: boolean): Promise<Requisition[]> {
    if (!wholeBundle || !req.bundleId) return [req];
    return this.prisma.requisition.findMany({
      where: { workspaceId, bundleId: req.bundleId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async nextRefs(client: DbClient, workspaceId: string, count: number): Promise<string[]> {
    const now = new Date();
    const prefix = `REQ-${String(now.getUTCFullYear()).slice(-2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}-`;
    const existing = await client.requisition.findMany({
      where: { workspaceId, reqRef: { startsWith: prefix } },
      select: { reqRef: true },
    });
    let max = 0;
    for (const r of existing) {
      const n = parseInt((r.reqRef ?? '').slice(prefix.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return Array.from({ length: count }, (_, i) => `${prefix}${String(max + i + 1).padStart(4, '0')}`);
  }

  /** Validates and normalises the header (department, vendor, BU/head) into Requisition columns. */
  private async resolveHeader(
    client: DbClient,
    workspaceId: string,
    dto: Partial<RequisitionHeaderDto>,
    existing?: Requisition,
  ): Promise<Prisma.RequisitionUncheckedUpdateInput> {
    const data: Prisma.RequisitionUncheckedUpdateInput = {};

    if (dto.date !== undefined) data.date = toDateOnly(dto.date);

    if (dto.departmentId) {
      const dept = await client.department.findFirst({ where: { id: dto.departmentId, workspaceId } });
      if (!dept) throw new BadRequestException('Department not found');
      data.departmentId = dept.id;
      data.departmentName = dept.name;
    } else if (dto.departmentName !== undefined) {
      const name = dto.departmentName.trim();
      if (!name) {
        data.departmentId = null;
        data.departmentName = null;
      } else {
        let dept = await client.department.findFirst({
          where: { workspaceId, name: { equals: name, mode: 'insensitive' } },
        });
        if (!dept) dept = await client.department.create({ data: { workspaceId, name } });
        data.departmentId = dept.id;
        data.departmentName = dept.name;
      }
    }

    const isNewVendor = dto.isNewVendor ?? existing?.isNewVendor ?? false;
    if (dto.isNewVendor !== undefined || dto.vendorId !== undefined || dto.vendorName !== undefined) {
      if (isNewVendor) {
        data.isNewVendor = true;
        data.vendorId = null;
        if (dto.vendorName !== undefined) data.vendorName = dto.vendorName.trim();
      } else if (dto.vendorId) {
        const vendor = await client.vendor.findFirst({ where: { id: dto.vendorId, workspaceId } });
        if (!vendor) throw new BadRequestException('Vendor not found in the Vendor Register');
        if (!vendorHasBankDetails(vendor)) {
          throw new BadRequestException(`Vendor "${vendor.name}" has no bank details — it can't be used until they're added`);
        }
        data.isNewVendor = false;
        data.vendorId = vendor.id;
        data.vendorName = vendor.name;
        data.vendorBank = vendor.bankName;
        data.vendorBankCode = vendor.bankCode;
        data.vendorAcctNo = vendor.bankAccountNumber;
        data.vendorAcctName = vendor.verifiedAccountName ?? vendor.accountName;
      } else if (dto.isNewVendor === false) {
        data.isNewVendor = false;
      }
    }
    if (isNewVendor) {
      if (dto.vendorBank !== undefined) data.vendorBank = dto.vendorBank.trim();
      if (dto.vendorBankCode !== undefined) data.vendorBankCode = dto.vendorBankCode.trim();
      if (dto.vendorAcctNo !== undefined) data.vendorAcctNo = dto.vendorAcctNo;
      if (dto.vendorAcctName !== undefined) data.vendorAcctName = dto.vendorAcctName.trim();
    }

    const costCenterId = dto.costCenterId !== undefined ? dto.costCenterId || null : existing?.costCenterId ?? null;
    const locationId = dto.locationId !== undefined ? dto.locationId || null : existing?.locationId ?? null;
    if (dto.costCenterId !== undefined) {
      if (costCenterId && !(await client.costCenter.findFirst({ where: { id: costCenterId, workspaceId } }))) {
        throw new BadRequestException('Business Unit not found');
      }
      data.costCenterId = costCenterId;
    }
    if (dto.locationId !== undefined || dto.costCenterId !== undefined) {
      if (locationId) {
        const loc = await client.location.findFirst({ where: { id: locationId, workspaceId } });
        if (!loc) throw new BadRequestException('BU Head not found');
        if (costCenterId && loc.costCenterId && loc.costCenterId !== costCenterId) {
          throw new BadRequestException('BU Head does not belong to the selected Business Unit');
        }
      }
      if (dto.locationId !== undefined) data.locationId = locationId;
    }

    if (dto.reason !== undefined) data.reason = dto.reason;
    if (dto.remarks !== undefined) data.remarks = dto.remarks;
    return data;
  }

  /** Spec §5.1 submit gate: vendor, amount, BU/head when required, and the Description Rules (§7). */
  private async submitIssues(workspaceId: string, reqs: Requisition[]): Promise<DescriptionIssue[]> {
    const buRequired = await readConfigFlag(this.prisma, workspaceId, 'business_units_required', false);
    const out: DescriptionIssue[] = [];
    for (const r of reqs) {
      const issues = [...validateDescription(r.description, r.vendorName)];
      if (r.isNewVendor) {
        if (!r.vendorName?.trim()) issues.push('Vendor name is required.');
        if (!r.vendorAcctName?.trim()) issues.push('Account name is required.');
        if (!r.vendorBank && !r.vendorBankCode) issues.push('Bank is required.');
        if (!r.vendorAcctNo || !/^\d{10}$/.test(r.vendorAcctNo)) issues.push('Account number must be 10 digits.');
      } else if (!r.vendorId) {
        issues.push('Pick a vendor from the register, or switch on "New vendor".');
      }
      if (toNum(r.total) <= 0) issues.push('Total must be greater than 0.');
      if (buRequired) {
        if (!r.costCenterId) issues.push('Business Unit is required.');
        if (!r.locationId) issues.push('BU Head is required.');
      }
      if (issues.length) out.push({ id: r.id, description: r.description, issues });
    }
    return out;
  }

  private throwIssues(issues: DescriptionIssue[]): never {
    throw new BadRequestException({
      message: 'Description does not follow the rules',
      errors: { issues },
    });
  }

  // ─── reads ─────────────────────────────────────────────────────────────

  async list(user: CurrentUserData, query: RequisitionQueryDto) {
    const { workspaceId } = user;
    const { page = 1, limit = 20, filter = 'open', search } = query;
    const base: Prisma.RequisitionWhereInput = {
      workspaceId,
      ...(this.ownOnly(user) && { requestedById: user.id }),
    };
    const q = search?.trim();
    if (q) {
      base.OR = [
        { vendorName: { contains: q, mode: 'insensitive' } },
        { vendor: { name: { contains: q, mode: 'insensitive' } } },
        { description: { contains: q, mode: 'insensitive' } },
        { departmentName: { contains: q, mode: 'insensitive' } },
        { bundleLabel: { contains: q, mode: 'insensitive' } },
        { reqRef: { contains: q, mode: 'insensitive' } },
      ];
    }
    const statuses = FILTER_STATUSES[filter];
    const where: Prisma.RequisitionWhereInput = { ...base, ...(statuses && { status: { in: statuses } }) };

    const [items, total, grouped] = await Promise.all([
      this.prisma.requisition.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: DETAIL_INCLUDE,
      }),
      this.prisma.requisition.count({ where }),
      this.prisma.requisition.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);

    const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Partial<Record<RequisitionStatus, number>>;
    const counts = Object.fromEntries(
      (Object.keys(FILTER_STATUSES) as RequisitionFilter[]).map((f) => {
        const s = FILTER_STATUSES[f];
        const n = s ? s.reduce((sum, st) => sum + (byStatus[st] ?? 0), 0) : grouped.reduce((sum, g) => sum + g._count._all, 0);
        return [f, n];
      }),
    );

    return { ...paginate(items, total, page, limit), counts };
  }

  async findOne(user: CurrentUserData, id: string) {
    const req = await this.load(user.workspaceId, id, user);
    const attachments = await this.attachments.listByGroup(user.workspaceId, req.attachmentGroupId);
    return { ...req, attachments };
  }

  // ─── writes (requester) ────────────────────────────────────────────────

  async create(user: CurrentUserData, dto: CreateRequisitionDto) {
    const { workspaceId } = user;
    await this.assertEnabled(workspaceId);
    const created = await this.prisma.$transaction(async (tx) => {
      const header = await this.resolveHeader(tx, workspaceId, { ...dto, isNewVendor: dto.isNewVendor ?? false });
      const units = dto.units ?? 1;
      const [reqRef] = await this.nextRefs(tx, workspaceId, 1);
      return tx.requisition.create({
        data: {
          ...(header as Prisma.RequisitionUncheckedCreateInput),
          workspaceId,
          reqRef,
          requestedById: user.id,
          requesterName: user.displayName || user.email,
          description: dto.description.trim(),
          units,
          unitName: dto.unitName || null,
          unitAmount: dto.unitAmount,
          total: round2(units * dto.unitAmount),
          status: 'DRAFT',
        },
      });
    });
    if (dto.submit) return this.submit(user, created.id, {});
    return this.findOne(user, created.id);
  }

  async createBundle(user: CurrentUserData, dto: CreateRequisitionBundleDto) {
    const { workspaceId } = user;
    await this.assertEnabled(workspaceId);
    const bundleId = randomUUID();
    const label = dto.bundleLabel.trim();
    if (!label) throw new BadRequestException('Bundle name is required');
    const ids = await this.prisma.$transaction(async (tx) => {
      const header = await this.resolveHeader(tx, workspaceId, { ...dto, isNewVendor: dto.isNewVendor ?? false });
      const refs = await this.nextRefs(tx, workspaceId, dto.items.length);
      const out: string[] = [];
      for (let i = 0; i < dto.items.length; i++) {
        const item = dto.items[i];
        const units = item.units ?? 1;
        const row = await tx.requisition.create({
          data: {
            ...(header as Prisma.RequisitionUncheckedCreateInput),
            workspaceId,
            reqRef: refs[i],
            requestedById: user.id,
            requesterName: user.displayName || user.email,
            description: item.description.trim(),
            units,
            unitName: item.unitName || null,
            unitAmount: item.unitAmount,
            total: round2(units * item.unitAmount),
            bundleId,
            bundleLabel: label,
            status: 'DRAFT',
          },
        });
        out.push(row.id);
      }
      return out;
    });
    if (dto.submit) await this.submit(user, ids[0], { wholeBundle: true });
    return this.prisma.requisition.findMany({
      where: { workspaceId, bundleId },
      include: DETAIL_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(user: CurrentUserData, id: string, dto: UpdateRequisitionDto) {
    const { workspaceId } = user;
    await this.assertEnabled(workspaceId);
    const existing = await this.load(workspaceId, id, user);
    this.assertCanEdit(existing, user);

    await this.prisma.$transaction(async (tx) => {
      const data = await this.resolveHeader(tx, workspaceId, dto, existing);
      if (dto.description !== undefined) data.description = dto.description.trim();
      if (dto.unitName !== undefined) data.unitName = dto.unitName || null;
      if (dto.units !== undefined || dto.unitAmount !== undefined) {
        const units = dto.units ?? toNum(existing.units);
        const unitAmount = dto.unitAmount ?? toNum(existing.unitAmount);
        data.units = units;
        data.unitAmount = unitAmount;
        data.total = round2(units * unitAmount);
      }
      const updated = await tx.requisition.update({ where: { id }, data });

      // A submitted requisition must keep satisfying the rules.
      if (updated.status === 'SUBMITTED') {
        const issues = await this.submitIssues(workspaceId, [updated]);
        if (issues.length) this.throwIssues(issues);
      }

      if (dto.bundleLabel !== undefined && existing.bundleId) {
        const label = dto.bundleLabel.trim();
        if (!label) throw new BadRequestException('Bundle name is required');
        await tx.requisition.updateMany({
          where: { workspaceId, bundleId: existing.bundleId, status: { in: EDITABLE } },
          data: { bundleLabel: label },
        });
      }
    });
    return this.findOne(user, id);
  }

  async remove(user: CurrentUserData, id: string) {
    const { workspaceId } = user;
    await this.assertEnabled(workspaceId);
    const existing = await this.load(workspaceId, id, user);
    if (!([...EDITABLE, 'REJECTED'] as RequisitionStatus[]).includes(existing.status)) {
      throw new ConflictException(`A ${existing.status.toLowerCase()} requisition can't be deleted`);
    }
    if (!this.isOwner(existing, user) && !isAdmin(user)) {
      throw new ForbiddenException('You can only delete your own requisitions');
    }
    await this.prisma.requisition.delete({ where: { id: existing.id } });
    return { success: true };
  }

  async submit(user: CurrentUserData, id: string, dto: ReviewRequisitionDto) {
    const { workspaceId } = user;
    await this.assertEnabled(workspaceId);
    const req = await this.load(workspaceId, id, user);
    if (!this.isOwner(req, user) && !canProcure(user)) {
      throw new ForbiddenException('You can only submit your own requisitions');
    }
    const targets = (await this.targets(workspaceId, req, dto.wholeBundle)).filter((r) =>
      (['DRAFT', 'RETURNED'] as RequisitionStatus[]).includes(r.status),
    );
    if (!targets.length) throw new ConflictException(`A ${req.status.toLowerCase()} requisition can't be submitted`);

    const issues = await this.submitIssues(workspaceId, targets);
    if (issues.length) this.throwIssues(issues);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const r of targets) {
        await tx.requisition.update({
          where: { id: r.id },
          data: { status: 'SUBMITTED', submittedAt: now, ...(dto.reviewNote !== undefined && { reviewNote: dto.reviewNote }) },
        });
        await this.audit.recordTx(tx, workspaceId, user, AUDIT_ACTIONS.REQUISITION_SUBMITTED, r.reqRef ?? r.description, {
          requisitionId: r.id,
          total: toNum(r.total),
          vendor: r.vendorName,
        }, { type: 'requisition', id: r.id });
      }
    });
    return this.findOne(user, id);
  }

  // ─── writes (procurement) ──────────────────────────────────────────────

  private async review(
    user: CurrentUserData,
    id: string,
    dto: ReviewRequisitionDto,
    action: 'clear' | 'return' | 'reject',
  ) {
    const { workspaceId } = user;
    await this.assertEnabled(workspaceId);
    const req = await this.load(workspaceId, id, user);
    const note = dto.reviewNote?.trim();
    if ((action === 'return' || action === 'reject') && !note) {
      throw new BadRequestException(`A note is required to ${action} a requisition`);
    }
    const allowedFrom: Record<typeof action, RequisitionStatus[]> = {
      clear: ['SUBMITTED'],
      return: ['SUBMITTED', 'PROCUREMENT_CLEARED'],
      reject: ['SUBMITTED', 'PROCUREMENT_CLEARED', 'RETURNED'],
    };
    const targets = (await this.targets(workspaceId, req, dto.wholeBundle)).filter((r) =>
      allowedFrom[action].includes(r.status),
    );
    if (!targets.length) throw new ConflictException(`A ${req.status.toLowerCase()} requisition can't be ${action === 'clear' ? 'cleared' : action + 'ed'}`);

    const now = new Date();
    const auditAction = {
      clear: AUDIT_ACTIONS.REQUISITION_CLEARED,
      return: AUDIT_ACTIONS.REQUISITION_RETURNED,
      reject: AUDIT_ACTIONS.REQUISITION_REJECTED,
    }[action];
    const data: Prisma.RequisitionUncheckedUpdateInput = {
      clear: { status: 'PROCUREMENT_CLEARED' as const, clearedAt: now, clearedById: user.id, ...(note ? { reviewNote: note } : {}) },
      return: { status: 'RETURNED' as const, returnedAt: now, returnedById: user.id, reviewNote: note, clearedAt: null, clearedById: null },
      reject: { status: 'REJECTED' as const, rejectedAt: now, rejectedById: user.id, rejectionReason: note, reviewNote: note },
    }[action];

    await this.prisma.$transaction(async (tx) => {
      for (const r of targets) {
        await tx.requisition.update({ where: { id: r.id }, data });
        await this.audit.recordTx(tx, workspaceId, user, auditAction, r.reqRef ?? r.description, {
          requisitionId: r.id,
          note: note ?? null,
          total: toNum(r.total),
        }, { type: 'requisition', id: r.id });
      }
    });
    return this.findOne(user, id);
  }

  clear(user: CurrentUserData, id: string, dto: ReviewRequisitionDto) {
    return this.review(user, id, dto, 'clear');
  }

  returnToRequester(user: CurrentUserData, id: string, dto: ReviewRequisitionDto) {
    return this.review(user, id, dto, 'return');
  }

  reject(user: CurrentUserData, id: string, dto: ReviewRequisitionDto) {
    return this.review(user, id, dto, 'reject');
  }

  /**
   * Undo the last step: procurement can send a cleared / returned / rejected requisition back to
   * SUBMITTED; the requester can pull their own SUBMITTED requisition back to DRAFT.
   */
  async undo(user: CurrentUserData, id: string, dto: ReviewRequisitionDto) {
    const { workspaceId } = user;
    await this.assertEnabled(workspaceId);
    const req = await this.load(workspaceId, id, user);
    let data: Prisma.RequisitionUncheckedUpdateInput;
    if ((['PROCUREMENT_CLEARED', 'RETURNED', 'REJECTED'] as RequisitionStatus[]).includes(req.status)) {
      if (!canProcure(user)) throw new ForbiddenException('Procurement role required');
      data = {
        status: 'SUBMITTED',
        clearedAt: null,
        clearedById: null,
        returnedAt: null,
        returnedById: null,
        rejectedAt: null,
        rejectedById: null,
        rejectionReason: null,
      };
    } else if (req.status === 'SUBMITTED') {
      if (!this.isOwner(req, user) && !canProcure(user)) throw new ForbiddenException('You can only undo your own submission');
      data = { status: 'DRAFT', submittedAt: null };
    } else {
      throw new ConflictException(`A ${req.status.toLowerCase()} requisition can't be undone`);
    }
    const targets = (await this.targets(workspaceId, req, dto.wholeBundle)).filter((r) => r.status === req.status);
    await this.prisma.requisition.updateMany({
      where: { workspaceId, id: { in: targets.map((t) => t.id) } },
      data: data as Prisma.RequisitionUncheckedUpdateManyInput,
    });
    await this.audit.record(workspaceId, user, 'requisition.undone', req.reqRef ?? req.description, {
      requisitionIds: targets.map((t) => t.id),
      from: req.status,
      to: data.status,
    }, { type: 'requisition', id: req.id });
    return this.findOne(user, id);
  }

  // ─── push to queue (accounts / approver) ───────────────────────────────

  async pushToQueue(user: CurrentUserData, dto: PushToQueueDto) {
    const { workspaceId } = user;
    await this.assertEnabled(workspaceId);
    const defaults = dto.applyToAll ?? {};
    const ids = dto.lines.map((l) => l.requisitionId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each requisition can only appear once');

    const reqs = await this.prisma.requisition.findMany({
      where: { workspaceId, id: { in: ids } },
      include: { queueItem: { select: { id: true } } },
    });
    const byId = new Map(reqs.map((r) => [r.id, r]));

    // 1. Validate every line up front.
    const errors: { requisitionId: string; error: string }[] = [];
    const lines = dto.lines.map((l) => ({
      ...l,
      payCategoryId: l.payCategoryId ?? defaults.payCategoryId,
      coaTagId: l.coaTagId ?? defaults.coaTagId,
      costCenterId: l.costCenterId ?? defaults.costCenterId,
      locationId: l.locationId ?? defaults.locationId,
      pnlPeriod: l.pnlPeriod ?? defaults.pnlPeriod,
    }));
    for (const l of lines) {
      const r = byId.get(l.requisitionId);
      if (!r) errors.push({ requisitionId: l.requisitionId, error: 'Requisition not found' });
      else if (r.queueItem || r.status === 'QUEUED') errors.push({ requisitionId: r.id, error: 'Already pushed to the queue' });
      else if (r.status !== 'PROCUREMENT_CLEARED') errors.push({ requisitionId: r.id, error: `Must be cleared by procurement first (status ${r.status})` });
      else if (!l.payCategoryId || !l.coaTagId) errors.push({ requisitionId: r.id, error: 'Payment category and COA are required' });
      else if (r.isNewVendor && (!r.vendorName?.trim() || !r.vendorAcctNo || !/^\d{10}$/.test(r.vendorAcctNo) || !(r.vendorBank || r.vendorBankCode))) {
        errors.push({ requisitionId: r.id, error: 'New vendor is missing a name, bank or 10-digit account number' });
      } else if (!r.isNewVendor && !r.vendorId) errors.push({ requisitionId: r.id, error: 'No vendor on this requisition' });
    }
    if (errors.length) throw new BadRequestException({ message: 'Some lines cannot be pushed to the queue', errors: { lines: errors } });

    const actor = { id: user.id, displayName: user.displayName || user.email };

    // 2. One transaction: register new vendors, create queue items, mark requisitions QUEUED.
    const created = await this.prisma.$transaction(
      async (tx) => {
        const ctx = await this.lineBuilder.loadContext(tx, workspaceId);
        const vendorByName = new Map([...ctx.vendors.values()].map((v) => [v.name.trim().toLowerCase(), v]));
        const out: { requisitionId: string; queueItemId: string; total: number; vendorName: string }[] = [];
        const lineErrors: { requisitionId: string; error: string }[] = [];

        for (const l of lines) {
          const r = byId.get(l.requisitionId)!;
          let vendorId = r.vendorId;

          if (r.isNewVendor) {
            const name = r.vendorName!.trim();
            let vendor = vendorByName.get(name.toLowerCase());
            if (!vendor) {
              vendor = await tx.vendor.create({
                data: {
                  workspaceId,
                  name,
                  bankName: r.vendorBank,
                  bankCode: r.vendorBankCode,
                  bankAccountNumber: r.vendorAcctNo,
                  accountName: r.vendorAcctName,
                },
              });
              await this.audit.recordTx(tx, workspaceId, user, AUDIT_ACTIONS.VENDOR_CREATED, vendor.name, {
                vendorId: vendor.id,
                source: 'requisition',
                requisitionId: r.id,
              }, { type: 'vendor', id: vendor.id });
            } else if (!vendorHasBankDetails(vendor)) {
              vendor = await tx.vendor.update({
                where: { id: vendor.id },
                data: {
                  bankName: r.vendorBank,
                  bankCode: r.vendorBankCode,
                  bankAccountNumber: r.vendorAcctNo,
                  accountName: r.vendorAcctName ?? vendor.accountName,
                },
              });
              await this.audit.recordTx(tx, workspaceId, user, AUDIT_ACTIONS.VENDOR_UPDATED, vendor.name, {
                vendorId: vendor.id,
                source: 'requisition',
                requisitionId: r.id,
                fields: ['bank details'],
              }, { type: 'vendor', id: vendor.id });
            }
            vendorByName.set(name.toLowerCase(), vendor);
            ctx.vendors.set(vendor.id, vendor);
            vendorId = vendor.id;
          }

          try {
            const built = await this.lineBuilder.build(
              workspaceId,
              actor,
              {
                date: r.date,
                vendorId: vendorId!,
                description: r.description,
                payCategoryId: l.payCategoryId!,
                coaTagId: l.coaTagId!,
                costCenterId: l.costCenterId ?? r.costCenterId,
                locationId: l.locationId ?? r.locationId,
                units: toNum(r.units),
                unitName: r.unitName,
                unitAmount: toNum(r.unitAmount),
                pnlPeriod: l.pnlPeriod,
                whtRateOverride: l.whtRateOverride,
                bundleId: r.bundleId,
                bundleLabel: r.bundleLabel,
                attachmentGroupId: r.attachmentGroupId,
                requisitionId: r.id,
                requestedByName: r.requesterName,
              },
              ctx,
            );
            const item = await tx.queueItem.create({ data: built.data });
            await tx.requisition.update({
              where: { id: r.id },
              data: {
                status: 'QUEUED',
                queuedAt: new Date(),
                queuedById: user.id,
                vendorId,
                isNewVendor: r.isNewVendor,
                payCategoryId: item.payCategoryId,
                coaTagId: item.coaTagId,
                costCenterId: item.costCenterId,
                locationId: item.locationId,
              },
            });
            await this.audit.recordTx(tx, workspaceId, user, AUDIT_ACTIONS.REQUISITION_QUEUED, r.reqRef ?? r.description, {
              requisitionId: r.id,
              queueItemId: item.id,
            }, { type: 'requisition', id: r.id });
            await this.audit.recordTx(tx, workspaceId, user, AUDIT_ACTIONS.QUEUE_ITEM_ADDED, `${item.vendorName} · ₦${toNum(item.total).toLocaleString('en-NG')}`, {
              queueItemId: item.id,
              requisitionId: r.id,
              total: toNum(item.total),
              source: 'requisition',
            }, { type: 'queue_item', id: item.id });
            out.push({ requisitionId: r.id, queueItemId: item.id, total: toNum(item.total), vendorName: item.vendorName ?? '' });
          } catch (error) {
            if (error instanceof BadRequestException) {
              lineErrors.push({ requisitionId: r.id, error: error.message });
            } else {
              throw error;
            }
          }
        }

        // Roll everything back (including vendors registered above) if any line is invalid.
        if (lineErrors.length) {
          throw new BadRequestException({ message: 'Some lines cannot be pushed to the queue', errors: { lines: lineErrors } });
        }
        return out;
      },
      { timeout: 30_000, maxWait: 5_000 },
    );

    const total = round2(created.reduce((s, c) => s + c.total, 0));
    await this.notifier.notify(workspaceId, 'queue_added', {
      title: 'New queue items',
      body: `${created.length} requisition item(s) pushed to the queue · ₦${total.toLocaleString('en-NG')}`,
      count: created.length,
      total,
      queueItemIds: created.map((c) => c.queueItemId),
      actorUserId: user.id,
      source: 'requisitions',
    });

    return {
      pushed: created.map((c) => c.requisitionId),
      queueItemIds: created.map((c) => c.queueItemId),
      errors: [] as { requisitionId: string; error: string }[],
    };
  }

  // ─── attachments ───────────────────────────────────────────────────────

  async addAttachment(user: CurrentUserData, id: string, file: UploadedFileLike | undefined) {
    const { workspaceId } = user;
    await this.assertEnabled(workspaceId);
    const req = await this.load(workspaceId, id, user);
    if (!this.isOwner(req, user) && !canProcure(user)) {
      throw new ForbiddenException('You can only add files to your own requisitions');
    }
    let groupId = req.attachmentGroupId;
    if (!groupId) {
      groupId = randomUUID();
      await this.prisma.requisition.update({ where: { id: req.id }, data: { attachmentGroupId: groupId } });
      // Keep a queue item pushed from this requisition on the same group.
      if (req.queueItem) {
        await this.prisma.queueItem.updateMany({
          where: { id: req.queueItem.id, workspaceId, attachmentGroupId: null },
          data: { attachmentGroupId: groupId },
        });
      }
    }
    return this.attachments.upload(workspaceId, user.id, file, { attachmentGroupId: groupId });
  }

  async listAttachments(user: CurrentUserData, id: string) {
    const req = await this.load(user.workspaceId, id, user);
    return this.attachments.listByGroup(user.workspaceId, req.attachmentGroupId);
  }
}
