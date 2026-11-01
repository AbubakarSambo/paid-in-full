import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, AuditActor } from '../platform/audit-log.service';
import { AUDIT_ACTIONS } from '../../common/audit-actions';
import { APP_CONFIG_DEFAULTS, isAllowedAppConfigKey } from './app-config.keys';

type Client = Prisma.TransactionClient | PrismaService;

/**
 * Per-workspace key/value settings (AppConfig). Global: inject `AppConfigService` anywhere.
 *
 *   const on = await this.appConfig.get<boolean>(workspaceId, 'requisitions_enabled');
 *   await this.appConfig.set(workspaceId, 'sheets_url', url, user);
 *
 * get() falls back to APP_CONFIG_DEFAULTS. set() writes a `config.updated` audit row unless
 * `{ audit: false }`. Service methods do not enforce the allow-list (internal callers may store any
 * key); the HTTP controller does.
 */
@Injectable()
export class AppConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async get<T = unknown>(workspaceId: string, key: string, fallback?: T, client: Client = this.prisma): Promise<T> {
    const row = await client.appConfig.findUnique({ where: { workspaceId_key: { workspaceId, key } } });
    if (row) return row.value as T;
    if (fallback !== undefined) return fallback;
    return (APP_CONFIG_DEFAULTS[key] ?? null) as T;
  }

  /** Values for several keys (defaults filled in). */
  async getMany(workspaceId: string, keys: string[]): Promise<Record<string, unknown>> {
    const rows = await this.prisma.appConfig.findMany({ where: { workspaceId, key: { in: keys } } });
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = APP_CONFIG_DEFAULTS[k] ?? null;
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  /** Every stored key (allow-listed only) plus defaults. */
  async getAll(workspaceId: string): Promise<Record<string, unknown>> {
    const rows = await this.prisma.appConfig.findMany({ where: { workspaceId } });
    const out: Record<string, unknown> = { ...APP_CONFIG_DEFAULTS };
    for (const r of rows) if (isAllowedAppConfigKey(r.key)) out[r.key] = r.value;
    return out;
  }

  async set(
    workspaceId: string,
    key: string,
    value: unknown,
    actor?: AuditActor,
    opts: { audit?: boolean; client?: Client } = {},
  ) {
    if (value === undefined) throw new BadRequestException(`A value is required for ${key}`);
    const client = opts.client ?? this.prisma;
    const json = (value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue)) as Prisma.InputJsonValue;
    const updatedById = typeof actor === 'string' ? actor : actor?.id;
    const row = await client.appConfig.upsert({
      where: { workspaceId_key: { workspaceId, key } },
      create: { workspaceId, key, value: json, updatedById },
      update: { value: json, updatedById },
    });
    if (opts.audit !== false) {
      await this.audit.record(workspaceId, actor ?? null, AUDIT_ACTIONS.CONFIG_UPDATED, key, { key, value });
    }
    return { key: row.key, value: row.value, updatedAt: row.updatedAt };
  }

  async setMany(workspaceId: string, values: Record<string, unknown>, actor?: AuditActor) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) continue;
      await this.set(workspaceId, k, v, actor, { audit: false });
      out[k] = v;
    }
    if (Object.keys(out).length) {
      await this.audit.record(workspaceId, actor ?? null, AUDIT_ACTIONS.CONFIG_UPDATED, Object.keys(out).join(', '), {
        values: out,
      });
    }
    return out;
  }
}
