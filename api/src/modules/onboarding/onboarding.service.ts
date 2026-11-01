import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../app-config/app-config.service';
import { AuditLogService } from '../platform/audit-log.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { MembersService } from '../users/members.service';
import { AUDIT_ACTIONS, CurrentUserData } from '../../common';
import { OnboardingWizardDto } from './dto';
import { CHECKLIST_STEPS, ChecklistKey, defaultCategories } from './onboarding.defaults';

const flagKey = (key: string) => `setup_${key}_done`;

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfig: AppConfigService,
    private readonly audit: AuditLogService,
    private readonly workspaces: WorkspacesService,
    private readonly members: MembersService,
  ) {}

  /** Spec §2 /onboarding: workspace profile, optional default categories, team invites. */
  async runWizard(user: CurrentUserData, dto: OnboardingWizardDto) {
    const workspaceId = user.workspaceId;
    await this.workspaces.update(workspaceId, user, {
      name: dto.name,
      logoUrl: dto.logoUrl,
      currency: dto.currency,
      timezone: dto.timezone,
      industry: dto.industry,
    });
    if (dto.industry) await this.appConfig.set(workspaceId, 'industry', dto.industry, user, { audit: false });

    let categoriesCreated = 0;
    let coaTagsCreated = 0;
    if (dto.createDefaultCategories) {
      const res = await this.createDefaultCategories(workspaceId, user, dto.industry);
      categoriesCreated = res.categories;
      coaTagsCreated = res.coaTags;
    }

    const invites: Array<{ email: string; ok: boolean; error?: string }> = [];
    for (const inv of dto.invites ?? []) {
      try {
        await this.members.invite(workspaceId, user, inv);
        invites.push({ email: inv.email, ok: true });
      } catch (error) {
        invites.push({ email: inv.email, ok: false, error: (error as Error).message });
      }
    }

    await this.appConfig.set(workspaceId, 'setup_wizard_done', true, user, { audit: false });
    await this.prisma.user.update({ where: { id: user.id }, data: { onboarded: true } });

    return { done: true, categoriesCreated, coaTagsCreated, invites, checklist: await this.checklist(workspaceId) };
  }

  private async createDefaultCategories(workspaceId: string, user: CurrentUserData, industry?: string) {
    let categories = 0;
    let coaTags = 0;
    const existingCount = await this.prisma.payCategory.count({ where: { workspaceId } });
    for (const [i, cat] of defaultCategories(industry).entries()) {
      let row = await this.prisma.payCategory.findUnique({ where: { workspaceId_name: { workspaceId, name: cat.name } } });
      if (!row) {
        row = await this.prisma.payCategory.create({
          data: { workspaceId, name: cat.name, code: cat.code, color: cat.color, includeInBudgets: cat.includeInBudgets, sortOrder: existingCount + i },
        });
        categories += 1;
        await this.audit.record(workspaceId, user, AUDIT_ACTIONS.CATEGORY_CREATED, cat.name, { source: 'onboarding' }, { type: 'pay_category', id: row.id });
      }
      const res = await this.prisma.coaTag.createMany({
        data: cat.coa.map((name, sortOrder) => ({ workspaceId, payCategoryId: row!.id, name, sortOrder })),
        skipDuplicates: true,
      });
      coaTags += res.count;
    }
    return { categories, coaTags };
  }

  /** Spec §13 checklist. Auto-detected steps OR manually ticked `setup_*_done` flags. */
  async checklist(workspaceId: string) {
    const [workspace, members, topups, admins, cats, coa, bus, vendors, cfgRows] = await Promise.all([
      this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { monnifyReservedAccountNumber: true } }),
      this.prisma.workspaceMember.count({ where: { workspaceId, isActive: true } }),
      this.prisma.walletTopup.count({ where: { workspaceId } }),
      this.prisma.workspaceMember.count({
        where: {
          workspaceId,
          isActive: true,
          role: { in: [WorkspaceRole.PAYER, WorkspaceRole.ADMIN] },
          user: { security: { pinHash: { not: null } } },
        },
      }),
      this.prisma.payCategory.count({ where: { workspaceId, isActive: true } }),
      this.prisma.coaTag.count({ where: { workspaceId, isActive: true } }),
      this.prisma.costCenter.count({ where: { workspaceId, isActive: true } }),
      this.prisma.vendor.count({ where: { workspaceId } }),
      this.prisma.appConfig.findMany({ where: { workspaceId, OR: [{ key: { startsWith: 'setup_' } }, { key: 'sheets_url' }] } }),
    ]);
    const cfg = new Map(cfgRows.map((r) => [r.key, r.value]));

    const detected: Partial<Record<ChecklistKey, boolean>> = {
      workspace_created: true,
      invite_users: members > 1,
      provision_wallet: !!workspace?.monnifyReservedAccountNumber,
      fund_wallet: topups > 0,
      apps_script_connected: typeof cfg.get('sheets_url') === 'string' && !!String(cfg.get('sheets_url')).trim(),
      set_pin: admins > 0,
      payment_categories: cats > 0,
      chart_of_accounts: coa > 0,
      business_units: bus > 0,
      sample_vendor: vendors > 0,
    };

    const steps = CHECKLIST_STEPS.map((s) => {
      const auto = !!detected[s.key];
      const manual = cfg.get(flagKey(s.key)) === true;
      return { key: s.key, label: s.label, done: auto || manual, autoDetected: auto, manuallyTicked: manual, canAutoDetect: s.detect, optional: 'optional' in s && !!s.optional };
    });
    const required = steps.filter((s) => !s.optional);
    const completed = required.filter((s) => s.done).length;
    return {
      steps,
      completed,
      total: required.length,
      percent: Math.round((completed / required.length) * 100),
      allDone: completed === required.length,
      dismissed: cfg.get('setup_checklist_dismissed') === true,
      wizardDone: cfg.get('setup_wizard_done') !== false,
    };
  }

  async setStep(user: CurrentUserData, key: string, done: boolean) {
    if (!CHECKLIST_STEPS.some((s) => s.key === key)) throw new BadRequestException(`Unknown checklist step "${key}"`);
    await this.appConfig.set(user.workspaceId, flagKey(key), done, user);
    return this.checklist(user.workspaceId);
  }

  async dismiss(user: CurrentUserData, dismissed: boolean) {
    await this.appConfig.set(user.workspaceId, 'setup_checklist_dismissed', dismissed, user, { audit: false });
    return this.checklist(user.workspaceId);
  }
}
