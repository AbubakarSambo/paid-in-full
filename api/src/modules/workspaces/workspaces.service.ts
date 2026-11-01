import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../app-config/app-config.service';
import { AuditLogService } from '../platform/audit-log.service';
import { AUDIT_ACTIONS, CurrentUserData } from '../../common';
import { storeImage, UploadedImageFile } from '../uploads/image-upload';
import { UpdateWorkspaceDto, WORKSPACE_CURRENCIES, INDUSTRIES } from './dto';

const LOGO_MAX_BYTES = 2 * 1024 * 1024; // spec §5.10 #4: 2 MB

/** dto field → AppConfig key */
const CONFIG_FIELDS = {
  requisitionsEnabled: 'requisitions_enabled',
  businessUnitsRequired: 'business_units_required',
  sessionTimeoutMinutes: 'session_timeout_minutes',
  requireReauthForDisbursement: 'require_reauth_for_disbursement',
} as const;

@Injectable()
export class WorkspacesService {
  constructor(
    private prisma: PrismaService,
    private appConfig: AppConfigService,
    private audit: AuditLogService,
  ) {}

  /** Workspace profile + the settings every screen needs (module toggle, BU rule, timeouts). */
  async findOne(id: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        currency: true,
        timezone: true,
        industry: true,
        tin: true,
        status: true,
        invoicePrefix: true,
        taxRate: true,
        trialEndDate: true,
        createdAt: true,
        monnifyReservedAccountNumber: true,
        monnifyReservedAccountName: true,
        monnifyReservedAccountBank: true,
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const cfg = await this.appConfig.getMany(id, Object.values(CONFIG_FIELDS));
    return {
      ...workspace,
      settings: {
        requisitionsEnabled: cfg.requisitions_enabled !== false,
        businessUnitsRequired: cfg.business_units_required === true,
        sessionTimeoutMinutes: Number(cfg.session_timeout_minutes) || 30,
        requireReauthForDisbursement: cfg.require_reauth_for_disbursement === true,
      },
      options: { currencies: WORKSPACE_CURRENCIES, industries: INDUSTRIES },
    };
  }

  async update(id: string, actor: CurrentUserData, dto: UpdateWorkspaceDto) {
    const before = await this.prisma.workspace.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Workspace not found');
    if (dto.logoUrl && !/^(https?:\/\/|data:image\/)/i.test(dto.logoUrl)) throw new BadRequestException('Logo must be an image URL.');
    if (dto.timezone) this.assertTimezone(dto.timezone);

    const data = {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl || null }),
      ...(dto.currency !== undefined && { currency: dto.currency }),
      ...(dto.timezone !== undefined && { timezone: dto.timezone }),
      ...(dto.industry !== undefined && { industry: dto.industry.trim() || null }),
      ...(dto.tin !== undefined && { tin: dto.tin.trim() || null }),
      ...(dto.invoicePrefix !== undefined && { invoicePrefix: dto.invoicePrefix.trim() || 'INV' }),
      ...(dto.taxRate !== undefined && { taxRate: dto.taxRate }),
    };
    if (Object.keys(data).length) {
      await this.prisma.workspace.update({ where: { id }, data });
      const changed = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, k === 'logoUrl' && typeof v === 'string' && v.startsWith('data:') ? '(uploaded image)' : v]),
      );
      await this.audit.record(id, actor, AUDIT_ACTIONS.CONFIG_UPDATED, 'workspace', changed);
    }

    const cfg: Record<string, unknown> = {};
    for (const [field, key] of Object.entries(CONFIG_FIELDS)) {
      const v = (dto as Record<string, unknown>)[field];
      if (v !== undefined) cfg[key] = v;
    }
    if (Object.keys(cfg).length) await this.appConfig.setMany(id, cfg, actor);

    return this.findOne(id);
  }

  async uploadLogo(id: string, actor: CurrentUserData, file: UploadedImageFile | undefined) {
    const url = await storeImage(file, { maxBytes: LOGO_MAX_BYTES, folder: 'logos', label: 'logo' });
    await this.prisma.workspace.update({ where: { id }, data: { logoUrl: url } });
    await this.audit.record(id, actor, AUDIT_ACTIONS.CONFIG_UPDATED, 'workspace', { logoUrl: '(uploaded image)' });
    return this.findOne(id);
  }

  private assertTimezone(tz: string) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    } catch {
      throw new BadRequestException(`Unknown timezone "${tz}". Use an IANA name like Africa/Lagos.`);
    }
  }
}
