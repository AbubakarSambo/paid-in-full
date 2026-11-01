import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, AuditActor } from '../audit';
import { AUDIT_ACTIONS } from '../../common/audit-actions';
import { a1, GoogleSheetsClient, parseServiceAccount } from './google-sheets.client';
import {
  BATCH_COL,
  BATCH_HEADER,
  BATCH_LAST_COL,
  BATCH_LINE_SELECT,
  batchRow,
  INVOICE_HEADER,
  INVOICE_LAST_COL,
  INVOICE_SELECT,
  invoiceKey,
  invoiceRow,
  parseCsv,
  SheetCell,
} from './sheets-layout';

// ─── Config keys (AppConfig, per workspace; spec §4 app_config) ───────────────
export const SHEETS_KEYS = {
  sheetsUrl: 'sheets_url',
  batchesTab: 'batches_tab_name',
  reconUrl: 'recon_sheet_url',
  invoicesUrl: 'invoices_sheets_url',
  invoicesTab: 'invoices_tab_name',
  batchesState: 'sheets_sync_state',
  invoicesState: 'invoices_sheets_sync_state',
} as const;

export type SheetsTargetName = 'batches' | 'invoices';
export type SheetsTransport = 'api' | 'apps_script';
/** Header-pill states (spec §8). */
export type SheetsSyncStatus = 'Not synced' | 'Syncing' | 'Synced' | 'Error';

export interface SheetsSyncResult {
  ok: boolean;
  /** NOT_CONFIGURED = nothing was attempted; ERROR = the push failed (state recorded). */
  status: 'SYNCED' | 'NOT_CONFIGURED' | 'NOT_FOUND' | 'ERROR' | 'SKIPPED';
  rows?: number;
  updated?: number;
  appended?: number;
  message?: string;
}

interface SyncState {
  state: 'SYNCING' | 'SYNCED' | 'ERROR';
  at: string;
  message?: string;
  lastSyncedAt?: string;
}

interface Target {
  name: SheetsTargetName;
  transport: SheetsTransport;
  url: string;
  spreadsheetId: string | null; // api only
  tab: string;
}

type ResolvedTarget = { ok: true; target: Target } | { ok: false; reason: string };

export type ReconStatus = 'Matched' | 'Fixable' | 'Mismatch' | 'No BU in app' | 'Not in app';

export interface ReconRow {
  rowNumber: number;
  batchRef: string;
  vendor: string;
  gross: number;
  sheetBu: string;
  sheetBuHead: string;
  appBu: string | null;
  appBuHead: string | null;
  batchItemId: string | null;
  status: ReconStatus;
  reason?: string;
}

const DEFAULT_TABS: Record<SheetsTargetName, string> = { batches: 'BATCHES', invoices: 'INVOICES' };
const SYNCING_STALE_MS = 5 * 60_000;

const SPREADSHEET_RE = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
const APPS_SCRIPT_RE = /^https:\/\/script\.google(usercontent)?\.com\/.+\/exec(\?.*)?$/;

/** Decide the transport from the URL format: Apps Script web app (`…/exec`) vs a Google Sheets URL. */
export function classifySheetsUrl(url: string): { transport: SheetsTransport; spreadsheetId: string | null } | null {
  const u = url.trim();
  if (!u) return null;
  if (APPS_SCRIPT_RE.test(u) || (/^https:\/\//.test(u) && /\/exec(\?.*)?$/.test(u))) {
    return { transport: 'apps_script', spreadsheetId: null };
  }
  const m = u.match(SPREADSHEET_RE);
  if (m) return { transport: 'api', spreadsheetId: m[1] };
  // A bare spreadsheet id is accepted too.
  if (/^[a-zA-Z0-9-_]{30,}$/.test(u)) return { transport: 'api', spreadsheetId: u };
  return null;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const money = (s: string) => {
  const v = Number(String(s).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(v) ? v : 0;
};

/**
 * Google Sheets "Mastersheet" sync (spec §9, §5.10 #9–10, #20).
 *
 * Other modules call syncBatch()/syncInvoice() after approval, disbursement, reclassify, invoice
 * changes… Those NEVER throw: failures are logged and recorded in AppConfig (sheets_sync_state /
 * invoices_sheets_sync_state) and on the rows' syncedToSheets flags. Await them, or `void` them if the
 * caller must not wait (note: on serverless, an un-awaited call can be cut off when the response ends).
 *
 * SHEETS_MOCK_MODE=true logs the rows instead of sending them (a URL must still be configured).
 */
@Injectable()
export class SheetsService {
  private readonly logger = new Logger(SheetsService.name);
  private client: GoogleSheetsClient | null | undefined;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogService,
  ) {}

  // ─── Public API for other modules ────────────────────────────────────────────

  /** Upsert every line of one batch into the BATCHES tab (key: batch ref + line id). Never throws. */
  async syncBatch(workspaceId: string, batchId: string): Promise<SheetsSyncResult> {
    try {
      return await this.pushBatches(workspaceId, { id: batchId });
    } catch (err) {
      return this.fail(workspaceId, 'batches', err);
    }
  }

  /** Upsert several batches in one sheet round-trip. Never throws. */
  async syncBatches(workspaceId: string, batchIds: string[]): Promise<SheetsSyncResult> {
    if (batchIds.length === 0) return { ok: true, status: 'SKIPPED', rows: 0 };
    try {
      return await this.pushBatches(workspaceId, { id: { in: batchIds } });
    } catch (err) {
      return this.fail(workspaceId, 'batches', err);
    }
  }

  /** Upsert one invoice into the INVOICES tab (key: invoice number). Never throws. */
  async syncInvoice(workspaceId: string, invoiceId: string): Promise<SheetsSyncResult> {
    try {
      const resolved = await this.resolveTarget(workspaceId, 'invoices');
      if (!resolved.ok) return { ok: false, status: 'NOT_CONFIGURED', message: resolved.reason };
      const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, workspaceId }, select: INVOICE_SELECT });
      if (!inv) return { ok: false, status: 'NOT_FOUND', message: 'Invoice not found' };
      const key = invoiceKey(inv);
      if (!key) return { ok: true, status: 'SKIPPED', message: 'Invoice has no number yet' };

      await this.setState(workspaceId, 'invoices', { state: 'SYNCING', at: new Date().toISOString() });
      const res = await this.upsert(resolved.target, [...INVOICE_HEADER], [invoiceRow(inv)], (r) => String(r[0] ?? ''), INVOICE_LAST_COL, [0]);
      await this.prisma.invoice.update({ where: { id: inv.id }, data: { syncedToSheets: true } });
      await this.markSynced(workspaceId, 'invoices', `Synced invoice ${key}`);
      return { ok: true, status: 'SYNCED', rows: 1, ...res };
    } catch (err) {
      try {
        await this.prisma.invoice.updateMany({ where: { id: invoiceId, workspaceId }, data: { syncedToSheets: false } });
      } catch {
        /* ignore */
      }
      return this.fail(workspaceId, 'invoices', err);
    }
  }

  // ─── Settings endpoints ──────────────────────────────────────────────────────

  async getConfig(workspaceId: string) {
    const cfg = await this.readConfig(workspaceId);
    const creds = this.apiClient();
    const describe = (url: string) => {
      const c = url ? classifySheetsUrl(url) : null;
      return c ? c.transport : null;
    };
    return {
      sheetsUrl: cfg.sheetsUrl,
      batchesTabName: cfg.batchesTab || DEFAULT_TABS.batches,
      reconSheetUrl: cfg.reconUrl,
      invoicesSheetsUrl: cfg.invoicesUrl,
      invoicesTabName: cfg.invoicesTab || DEFAULT_TABS.invoices,
      batchesTransport: describe(cfg.sheetsUrl),
      invoicesTransport: describe(cfg.invoicesUrl),
      credentialsConfigured: !!creds,
      serviceAccountEmail: creds?.serviceAccountEmail ?? null,
      mockMode: this.mockMode,
    };
  }

  async saveConfig(
    workspaceId: string,
    actor: AuditActor & { id: string },
    dto: {
      sheetsUrl?: string;
      batchesTabName?: string;
      reconSheetUrl?: string;
      invoicesSheetsUrl?: string;
      invoicesTabName?: string;
    },
  ) {
    const updates: [string, string][] = [];
    const url = (field: string, key: string, v: string | undefined, allowAppsScript = true) => {
      if (v === undefined) return;
      const t = v.trim();
      if (t) {
        const c = classifySheetsUrl(t);
        if (!c) throw new BadRequestException(`${field}: expected a Google Sheets URL or an Apps Script /exec URL`);
        if (!allowAppsScript && c.transport === 'apps_script') {
          throw new BadRequestException(`${field}: the reconciliation link must be a Google Sheets URL (it is read, not written)`);
        }
      }
      updates.push([key, t]);
    };
    url('sheetsUrl', SHEETS_KEYS.sheetsUrl, dto.sheetsUrl);
    url('reconSheetUrl', SHEETS_KEYS.reconUrl, dto.reconSheetUrl, false);
    url('invoicesSheetsUrl', SHEETS_KEYS.invoicesUrl, dto.invoicesSheetsUrl);
    if (dto.batchesTabName !== undefined) updates.push([SHEETS_KEYS.batchesTab, dto.batchesTabName.trim() || DEFAULT_TABS.batches]);
    if (dto.invoicesTabName !== undefined) updates.push([SHEETS_KEYS.invoicesTab, dto.invoicesTabName.trim() || DEFAULT_TABS.invoices]);

    await this.prisma.$transaction(
      updates.map(([key, value]) =>
        this.prisma.appConfig.upsert({
          where: { workspaceId_key: { workspaceId, key } },
          create: { workspaceId, key, value, updatedById: actor.id },
          update: { value, updatedById: actor.id },
        }),
      ),
    );
    await this.audit.record(workspaceId, actor, AUDIT_ACTIONS.CONFIG_UPDATED, 'google_sheets', {
      keys: updates.map(([k]) => k),
    });

    const result = await this.getConfig(workspaceId);
    const warnings: string[] = [];
    if (!result.credentialsConfigured && !this.mockMode) {
      if (result.batchesTransport === 'api' || result.invoicesTransport === 'api') {
        warnings.push('A Google Sheets URL needs the service account (GOOGLE_SHEETS_CREDENTIALS_BASE64) on the server — or use an Apps Script /exec URL.');
      }
    }
    if (result.batchesTransport === 'apps_script' && !result.reconSheetUrl) {
      warnings.push('Add the reconciliation sheet link to use Sheet Recon with an Apps Script URL.');
    }
    return { ...result, warnings };
  }

  /** Settings "Test": writes a TEST row to the tab. Throws a clear error when not configured or failing. */
  async test(workspaceId: string, which: SheetsTargetName, actorEmail?: string) {
    const target = await this.requireTarget(workspaceId, which);
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
    const row: SheetCell[] = ['TEST', new Date().toISOString(), 'Paid in Full connection test', ws?.name ?? '', actorEmail ?? ''];
    try {
      if (this.mockMode) {
        this.logger.log(`[SHEETS MOCK] test → ${target.transport} tab=${target.tab}: ${JSON.stringify(row)}`);
      } else if (target.transport === 'apps_script') {
        await this.appsScript(target.url, { action: 'test', tabName: target.tab, rows: [row] });
      } else {
        const client = this.requireClient();
        await client.ensureTab(target.spreadsheetId!, target.tab);
        await this.writeHeader(client, target, which === 'batches' ? [...BATCH_HEADER] : [...INVOICE_HEADER], which === 'batches' ? BATCH_LAST_COL : INVOICE_LAST_COL);
        await client.append(target.spreadsheetId!, a1(target.tab, 'A1'), [row]);
      }
    } catch (err) {
      throw new BadGatewayException(`Sheets test failed: ${(err as Error).message}`);
    }
    return { ok: true, transport: target.transport, tab: target.tab, mock: this.mockMode, message: `TEST row written to ${target.tab}` };
  }

  /** Header pill: Not synced / Syncing / Synced / Error. */
  async status(workspaceId: string) {
    const cfg = await this.readConfig(workspaceId);
    const resolved = await this.resolveTarget(workspaceId, 'batches', cfg);
    const raw = await this.prisma.appConfig.findUnique({
      where: { workspaceId_key: { workspaceId, key: SHEETS_KEYS.batchesState } },
    });
    const state = (raw?.value ?? null) as SyncState | null;
    const unsyncedBatches = resolved.ok
      ? await this.prisma.batch.count({ where: { workspaceId, syncedToSheets: false, payoutStatus: { not: 'CANCELLED' } } })
      : 0;

    let status: SheetsSyncStatus = 'Not synced';
    if (resolved.ok && state) {
      const age = Date.now() - new Date(state.at).getTime();
      if (state.state === 'SYNCING' && age < SYNCING_STALE_MS) status = 'Syncing';
      else if (state.state === 'ERROR') status = 'Error';
      else if (unsyncedBatches > 0) status = 'Not synced';
      else if (state.state === 'SYNCED' || state.lastSyncedAt) status = 'Synced';
    } else if (resolved.ok && unsyncedBatches === 0) {
      status = 'Synced';
    }
    return {
      configured: resolved.ok,
      reason: resolved.ok ? null : resolved.reason,
      transport: resolved.ok ? resolved.target.transport : null,
      status,
      lastSyncedAt: state?.lastSyncedAt ?? null,
      lastError: state?.state === 'ERROR' ? state.message ?? null : null,
      lastMessage: state?.message ?? null,
      unsyncedBatches,
      mockMode: this.mockMode,
    };
  }

  /** Batches → "Resync sheet". Throws when not configured or failed, so the UI can toast the reason. */
  async resyncBatch(workspaceId: string, batchId: string) {
    await this.requireTarget(workspaceId, 'batches');
    const exists = await this.prisma.batch.findFirst({ where: { id: batchId, workspaceId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Batch not found');
    const res = await this.syncBatch(workspaceId, batchId);
    if (!res.ok) throw new BadGatewayException(res.message ?? 'Sheet sync failed');
    return res;
  }

  async resyncInvoice(workspaceId: string, invoiceId: string) {
    await this.requireTarget(workspaceId, 'invoices');
    const res = await this.syncInvoice(workspaceId, invoiceId);
    if (res.status === 'NOT_FOUND') throw new NotFoundException('Invoice not found');
    if (!res.ok) throw new BadGatewayException(res.message ?? 'Sheet sync failed');
    return res;
  }

  /** Settings "Backfill missing batches" from a date (batch date ≥ from, not yet synced, not cancelled). */
  async backfill(workspaceId: string, from: string, actor: AuditActor) {
    await this.requireTarget(workspaceId, 'batches');
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    if (Number.isNaN(fromDate.getTime())) throw new BadRequestException('from must be YYYY-MM-DD');
    const batches = await this.prisma.batch.findMany({
      where: { workspaceId, date: { gte: fromDate }, syncedToSheets: false, payoutStatus: { not: 'CANCELLED' } },
      select: { id: true },
    });
    if (batches.length === 0) return { ok: true, batches: 0, rows: 0, message: 'Nothing missing — every batch since that date is in the sheet' };
    const res = await this.syncBatches(workspaceId, batches.map((b) => b.id));
    if (!res.ok) throw new BadGatewayException(res.message ?? 'Backfill failed');
    await this.audit.record(workspaceId, actor, 'sheets.backfilled', 'google_sheets', { from, batches: batches.length, rows: res.rows });
    return { ...res, batches: batches.length };
  }

  /** Settings "Wipe & repush": rewrites every row (all non-cancelled batches) in the current layout. */
  async wipeAndRepush(workspaceId: string, actor: AuditActor) {
    const target = await this.requireTarget(workspaceId, 'batches');
    await this.setState(workspaceId, 'batches', { state: 'SYNCING', at: new Date().toISOString(), message: 'Wipe & repush' });
    try {
      const batches = await this.prisma.batch.findMany({
        where: { workspaceId, payoutStatus: { not: 'CANCELLED' } },
        orderBy: [{ date: 'asc' }, { batchRef: 'asc' }],
        select: { id: true, batchRef: true, payCategoryName: true, items: { select: { ...BATCH_LINE_SELECT, queueItemId: true }, orderBy: { createdAt: 'asc' } } },
      });
      const rows = batches.flatMap((b) => b.items.map((l) => batchRow(b, this.lineForSheet(l))));
      await this.withLock(this.lockKey(target), async () => {
        if (this.mockMode) {
          this.logger.log(`[SHEETS MOCK] wipe & repush ${target.tab}: ${rows.length} rows`);
          rows.slice(0, 20).forEach((r) => this.logger.log(`[SHEETS MOCK]   ${JSON.stringify(r)}`));
        } else if (target.transport === 'apps_script') {
          // ASSUMPTION (unverified): the Apps Script honours `replace: true` by clearing rows 2+ first.
          await this.appsScript(target.url, { action: 'appendRows', tabName: target.tab, header: [...BATCH_HEADER], rows, replace: true });
        } else {
          const client = this.requireClient();
          await client.ensureTab(target.spreadsheetId!, target.tab);
          await client.clear(target.spreadsheetId!, a1(target.tab, 'A2:Z'));
          await this.writeHeader(client, target, [...BATCH_HEADER], BATCH_LAST_COL);
          const CHUNK = 5000;
          for (let i = 0; i < rows.length; i += CHUNK) {
            const part = rows.slice(i, i + CHUNK);
            await client.update(target.spreadsheetId!, a1(target.tab, `A${i + 2}:${BATCH_LAST_COL}${i + 1 + part.length}`), part);
          }
        }
      });
      await this.markRowsSynced(workspaceId, batches);
      await this.markSynced(workspaceId, 'batches', `Wipe & repush: ${rows.length} rows`);
      await this.audit.record(workspaceId, actor, 'sheets.wipe_repush', 'google_sheets', { batches: batches.length, rows: rows.length });
      return { ok: true, batches: batches.length, rows: rows.length, mock: this.mockMode };
    } catch (err) {
      const res = await this.fail(workspaceId, 'batches', err);
      throw new BadGatewayException(res.message ?? 'Wipe & repush failed');
    }
  }

  // ─── Sheet Recon (spec §5.10 #20) ────────────────────────────────────────────

  async recon(workspaceId: string) {
    const { spreadsheetId, tab } = await this.reconSource(workspaceId);
    const sheetRows = await this.readSheet(workspaceId, spreadsheetId, tab);

    const lines = await this.prisma.batchItem.findMany({
      where: { batch: { workspaceId, payoutStatus: { not: 'CANCELLED' } } },
      select: {
        id: true,
        vendorName: true,
        total: true,
        costCenterId: true,
        costCenter: { select: { name: true, code: true } },
        location: { select: { name: true } },
        batch: { select: { batchRef: true } },
      },
    });
    const byId = new Map(lines.map((l) => [l.id, l]));
    const byFuzzy = new Map<string, (typeof lines)[number][]>();
    for (const l of lines) {
      const k = `${norm(l.batch.batchRef)}|${norm(l.vendorName)}|${Math.round(Number(l.total))}`;
      byFuzzy.set(k, [...(byFuzzy.get(k) ?? []), l]);
    }
    const used = new Set<string>();

    const rows: ReconRow[] = [];
    sheetRows.forEach((cells, idx) => {
      const rowNumber = idx + 1;
      const batchRef = (cells[BATCH_COL.batchRef] ?? '').trim();
      if (!batchRef) return;
      if (rowNumber === 1 && norm(batchRef).includes('batch')) return; // header
      if (batchRef.toUpperCase() === 'TEST') return;
      const vendor = (cells[BATCH_COL.vendor] ?? '').trim();
      const gross = money(cells[BATCH_COL.gross] ?? '');
      const sheetBu = (cells[BATCH_COL.bu] ?? '').trim();
      const sheetBuHead = (cells[BATCH_COL.buHead] ?? '').trim();
      const lineId = (cells[BATCH_COL.lineId] ?? '').trim();

      let line = lineId && byId.has(lineId) && !used.has(lineId) ? byId.get(lineId)! : undefined;
      if (!line) {
        const candidates = byFuzzy.get(`${norm(batchRef)}|${norm(vendor)}|${Math.round(gross)}`) ?? [];
        line = candidates.find((c) => !used.has(c.id));
      }
      const base = { rowNumber, batchRef, vendor, gross, sheetBu, sheetBuHead };
      if (!line) {
        rows.push({ ...base, appBu: null, appBuHead: null, batchItemId: null, status: 'Not in app' });
        return;
      }
      used.add(line.id);
      const appBu = line.costCenter?.name ?? null;
      const appBuHead = line.location?.name ?? null;
      const out = { ...base, appBu, appBuHead, batchItemId: line.id };
      if (!line.costCenterId || !appBu) {
        rows.push({ ...out, status: 'No BU in app' });
        return;
      }
      const buMatches = !sheetBu || norm(sheetBu) === norm(appBu) || (!!line.costCenter?.code && norm(sheetBu) === norm(line.costCenter.code));
      const headMatches = !sheetBuHead || norm(sheetBuHead) === norm(appBuHead);
      const amountMatches = Math.abs(gross - Number(line.total)) <= 1;
      if (!buMatches || !headMatches || !amountMatches) {
        const why = [!buMatches && 'BU differs', !headMatches && 'BU Head differs', !amountMatches && 'amount differs'].filter(Boolean).join(', ');
        rows.push({ ...out, status: 'Mismatch', reason: why });
      } else if (!sheetBu || (!sheetBuHead && appBuHead)) {
        rows.push({ ...out, status: 'Fixable', reason: 'BU/BU Head missing in sheet' });
      } else {
        rows.push({ ...out, status: 'Matched' });
      }
    });

    const summary: Record<ReconStatus, number> = { Matched: 0, Fixable: 0, Mismatch: 0, 'No BU in app': 0, 'Not in app': 0 };
    for (const r of rows) summary[r.status] += 1;
    return {
      tab,
      sheetRows: rows.length,
      summary,
      appLinesNotInSheet: lines.length - used.size,
      rows,
    };
  }

  /** "Fill BU/BU Head into sheet": writes the app's BU and BU Head into the Fixable rows (columns J:K). */
  async reconFill(workspaceId: string, actor: AuditActor) {
    const { spreadsheetId, tab } = await this.reconSource(workspaceId);
    const report = await this.recon(workspaceId);
    const fixable = report.rows.filter((r) => r.status === 'Fixable');
    if (fixable.length === 0) return { ok: true, filled: 0, message: 'No fixable rows' };
    const colBu = String.fromCharCode(65 + BATCH_COL.bu);
    const colHead = String.fromCharCode(65 + BATCH_COL.buHead);
    const data = fixable.map((r) => ({
      range: a1(tab, `${colBu}${r.rowNumber}:${colHead}${r.rowNumber}`),
      values: [[r.appBu ?? '', r.appBuHead ?? '']],
    }));
    if (this.mockMode) {
      data.forEach((d) => this.logger.log(`[SHEETS MOCK] recon fill ${d.range} = ${JSON.stringify(d.values[0])}`));
    } else {
      const client = this.apiClient();
      if (!client) {
        throw new BadRequestException(
          'Filling the sheet needs the Google service account (GOOGLE_SHEETS_CREDENTIALS_BASE64) with Editor access to the reconciliation sheet',
        );
      }
      try {
        for (let i = 0; i < data.length; i += 500) await client.batchUpdate(spreadsheetId, data.slice(i, i + 500));
      } catch (err) {
        throw new BadGatewayException(`Could not write to the sheet: ${(err as Error).message}`);
      }
    }
    await this.audit.record(workspaceId, actor, 'sheets.recon_filled', 'google_sheets', { rows: fixable.length });
    return { ok: true, filled: fixable.length, mock: this.mockMode };
  }

  // ─── Internals ───────────────────────────────────────────────────────────────

  private get mockMode(): boolean {
    return String(this.config.get('SHEETS_MOCK_MODE') ?? process.env.SHEETS_MOCK_MODE ?? '').toLowerCase() === 'true';
  }

  private apiClient(): GoogleSheetsClient | null {
    if (this.client === undefined) {
      const creds = parseServiceAccount(
        this.config.get<string>('googleSheets.credentialsBase64') ?? process.env.GOOGLE_SHEETS_CREDENTIALS_BASE64,
      );
      this.client = creds ? new GoogleSheetsClient(creds) : null;
    }
    return this.client;
  }

  private requireClient(): GoogleSheetsClient {
    const c = this.apiClient();
    if (!c) throw new BadRequestException('Google Sheets API credentials are not configured (GOOGLE_SHEETS_CREDENTIALS_BASE64)');
    return c;
  }

  private async readConfig(workspaceId: string) {
    const rows = await this.prisma.appConfig.findMany({
      where: {
        workspaceId,
        key: { in: [SHEETS_KEYS.sheetsUrl, SHEETS_KEYS.batchesTab, SHEETS_KEYS.reconUrl, SHEETS_KEYS.invoicesUrl, SHEETS_KEYS.invoicesTab] },
      },
    });
    const get = (k: string) => str(rows.find((r) => r.key === k)?.value);
    return {
      sheetsUrl: get(SHEETS_KEYS.sheetsUrl),
      batchesTab: get(SHEETS_KEYS.batchesTab),
      reconUrl: get(SHEETS_KEYS.reconUrl),
      invoicesUrl: get(SHEETS_KEYS.invoicesUrl),
      invoicesTab: get(SHEETS_KEYS.invoicesTab),
    };
  }

  private async resolveTarget(
    workspaceId: string,
    name: SheetsTargetName,
    cfg?: Awaited<ReturnType<SheetsService['readConfig']>>,
  ): Promise<ResolvedTarget> {
    const c = cfg ?? (await this.readConfig(workspaceId));
    const url = name === 'batches' ? c.sheetsUrl : c.invoicesUrl;
    const tab = (name === 'batches' ? c.batchesTab : c.invoicesTab) || DEFAULT_TABS[name];
    const label = name === 'batches' ? 'Google Sheets sync (Batches)' : 'Google Sheets sync (Invoices)';
    if (!url) return { ok: false, reason: `${label} is not configured: add a Sheet URL or Apps Script /exec URL in Settings` };
    const kind = classifySheetsUrl(url);
    if (!kind) return { ok: false, reason: `${label} is not configured: the saved URL is not a Google Sheets or Apps Script URL` };
    if (kind.transport === 'api' && !this.mockMode && !this.apiClient()) {
      return {
        ok: false,
        reason: `${label} is not configured: a Google Sheets URL needs the service account credentials (GOOGLE_SHEETS_CREDENTIALS_BASE64) on the server, or use an Apps Script /exec URL`,
      };
    }
    return { ok: true, target: { name, transport: kind.transport, url, spreadsheetId: kind.spreadsheetId, tab } };
  }

  private async requireTarget(workspaceId: string, name: SheetsTargetName): Promise<Target> {
    const r = await this.resolveTarget(workspaceId, name);
    if (!r.ok) throw new BadRequestException(r.reason);
    return r.target;
  }

  private lineForSheet<T extends { payoutStatus: string; returnedAt: Date | null }>(l: T): T {
    return l.returnedAt ? ({ ...l, payoutStatus: 'RETURNED' } as unknown as T) : l;
  }

  private async pushBatches(workspaceId: string, where: Prisma.BatchWhereInput): Promise<SheetsSyncResult> {
    const resolved = await this.resolveTarget(workspaceId, 'batches');
    if (!resolved.ok) return { ok: false, status: 'NOT_CONFIGURED', message: resolved.reason };
    const batches = await this.prisma.batch.findMany({
      where: { ...where, workspaceId },
      orderBy: [{ date: 'asc' }, { batchRef: 'asc' }],
      select: {
        id: true,
        batchRef: true,
        payCategoryName: true,
        items: { select: { ...BATCH_LINE_SELECT, queueItemId: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (batches.length === 0) return { ok: false, status: 'NOT_FOUND', message: 'Batch not found' };

    await this.setState(workspaceId, 'batches', { state: 'SYNCING', at: new Date().toISOString() });
    const rows = batches.flatMap((b) => b.items.map((l) => batchRow(b, this.lineForSheet(l))));
    try {
      const res = await this.upsert(
        resolved.target,
        [...BATCH_HEADER],
        rows,
        (r) => `${r[BATCH_COL.batchRef]}|${r[BATCH_COL.lineId]}`,
        BATCH_LAST_COL,
        [BATCH_COL.batchRef, BATCH_COL.lineId],
      );
      await this.markRowsSynced(workspaceId, batches);
      const label = batches.length === 1 ? batches[0].batchRef : `${batches.length} batches`;
      await this.markSynced(workspaceId, 'batches', `Synced ${label} (${rows.length} rows)`);
      return { ok: true, status: 'SYNCED', rows: rows.length, ...res };
    } catch (err) {
      try {
        await this.prisma.batch.updateMany({ where: { id: { in: batches.map((b) => b.id) } }, data: { syncedToSheets: false } });
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  private async markRowsSynced(
    workspaceId: string,
    batches: { id: string; items: { id: string; queueItemId: string | null }[] }[],
  ) {
    const batchIds = batches.map((b) => b.id);
    const itemIds = batches.flatMap((b) => b.items.map((i) => i.id));
    const queueIds = batches.flatMap((b) => b.items.map((i) => i.queueItemId).filter((q): q is string => !!q));
    await this.prisma.$transaction([
      this.prisma.batch.updateMany({ where: { workspaceId, id: { in: batchIds } }, data: { syncedToSheets: true } }),
      this.prisma.batchItem.updateMany({ where: { id: { in: itemIds } }, data: { syncedToSheets: true } }),
      this.prisma.queueItem.updateMany({ where: { workspaceId, id: { in: queueIds } }, data: { syncedToSheets: true } }),
    ]);
  }

  /**
   * Upsert rows by key. Direct API: read the key columns, update matching rows in place, append the rest.
   * Apps Script: POST {action:'appendRows', tabName, rows} (+ header/keyColumns so an upsert-aware script
   * can update in place — ASSUMPTION, unverified: a plain appendRows script will append duplicates).
   */
  private async upsert(
    target: Target,
    header: string[],
    rows: SheetCell[][],
    keyOf: (row: SheetCell[]) => string,
    lastCol: string,
    keyCols: number[],
  ): Promise<{ updated: number; appended: number }> {
    if (rows.length === 0) return { updated: 0, appended: 0 };
    return this.withLock(this.lockKey(target), async () => {
      if (this.mockMode) {
        this.logger.log(`[SHEETS MOCK] upsert ${rows.length} rows → ${target.transport} tab=${target.tab}`);
        rows.forEach((r) => this.logger.log(`[SHEETS MOCK]   ${JSON.stringify(r)}`));
        return { updated: 0, appended: rows.length };
      }
      if (target.transport === 'apps_script') {
        await this.appsScript(target.url, {
          action: 'appendRows',
          tabName: target.tab,
          header,
          rows,
          keyColumns: keyCols.map((i) => header[i]),
        });
        return { updated: 0, appended: rows.length };
      }
      const client = this.requireClient();
      const id = target.spreadsheetId!;
      await client.ensureTab(id, target.tab);
      await this.writeHeader(client, target, header, lastCol);
      const cols = keyCols.map((i) => String.fromCharCode(65 + i));
      const keyRanges = await client.batchGet(id, cols.map((c) => a1(target.tab, `${c}2:${c}`)));
      const existing = new Map<string, number>();
      const len = Math.max(...keyRanges.map((r) => r.length), 0);
      for (let i = 0; i < len; i++) {
        const fake: SheetCell[] = [];
        keyCols.forEach((col, k) => (fake[col] = keyRanges[k][i]?.[0] ?? ''));
        const key = keyOf(fake);
        if (key.replace(/\|/g, '')) existing.set(key, i + 2);
      }
      const updates: { range: string; values: SheetCell[][] }[] = [];
      const appends: SheetCell[][] = [];
      for (const r of rows) {
        const rowNo = existing.get(keyOf(r));
        if (rowNo) updates.push({ range: a1(target.tab, `A${rowNo}:${lastCol}${rowNo}`), values: [r] });
        else appends.push(r);
      }
      for (let i = 0; i < updates.length; i += 500) await client.batchUpdate(id, updates.slice(i, i + 500));
      if (appends.length) await client.append(id, a1(target.tab, `A1:${lastCol}`), appends);
      return { updated: updates.length, appended: appends.length };
    });
  }

  /** Keep row 1 as the header (spec §9). */
  private async writeHeader(client: GoogleSheetsClient, target: Target, header: string[], lastCol: string) {
    await client.update(target.spreadsheetId!, a1(target.tab, `A1:${lastCol}1`), [header]);
  }

  /** Apps Script web app transport. Apps Script answers POSTs with a 302 to the result, which fetch follows. */
  private async appsScript(url: string, payload: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Apps Script returned HTTP ${res.status}`);
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      // A sign-in page means the web app isn't deployed as "Anyone" / "Execute as me".
      if (/<html/i.test(text)) throw new Error('Apps Script did not return JSON — deploy the web app with access "Anyone"');
      return text;
    }
    if (body && (body.ok === false || body.success === false || body.error)) {
      throw new Error(`Apps Script error: ${body.error ?? body.message ?? 'unknown error'}`);
    }
    return body;
  }

  private async reconSource(workspaceId: string) {
    const cfg = await this.readConfig(workspaceId);
    const tab = cfg.batchesTab || DEFAULT_TABS.batches;
    const recon = cfg.reconUrl ? classifySheetsUrl(cfg.reconUrl) : null;
    if (recon?.spreadsheetId) return { spreadsheetId: recon.spreadsheetId, tab };
    const main = cfg.sheetsUrl ? classifySheetsUrl(cfg.sheetsUrl) : null;
    if (main?.spreadsheetId) return { spreadsheetId: main.spreadsheetId, tab };
    throw new BadRequestException(
      'Sheet Recon is not configured: set the reconciliation sheet link (needed when the sync URL is an Apps Script URL)',
    );
  }

  /** All rows (A:Q) of the mastersheet tab. Uses the API when credentials exist, else the public CSV export. */
  private async readSheet(workspaceId: string, spreadsheetId: string, tab: string): Promise<string[][]> {
    const client = this.apiClient();
    try {
      if (client) return await client.getValues(spreadsheetId, a1(tab, `A1:${BATCH_LAST_COL}`));
      if (this.mockMode) {
        // Mock: pretend the sheet mirrors the app exactly.
        const batches = await this.prisma.batch.findMany({
          where: { workspaceId, payoutStatus: { not: 'CANCELLED' } },
          select: { batchRef: true, payCategoryName: true, items: { select: BATCH_LINE_SELECT } },
        });
        return [[...BATCH_HEADER], ...batches.flatMap((b) => b.items.map((l) => batchRow(b, l).map(String)))];
      }
      // Works when the sheet is shared "Anyone with the link can view".
      const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const text = await res.text();
      if (!res.ok || /^\s*<(!doctype|html)/i.test(text)) {
        throw new Error('the sheet is not readable — share it as "Anyone with the link can view" or configure the service account');
      }
      return parseCsv(text);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadGatewayException(`Could not read the mastersheet: ${(err as Error).message}`);
    }
  }

  private lockKey(t: Target) {
    return `${t.transport}:${t.spreadsheetId ?? t.url}:${t.tab}`;
  }

  /** Serialise writes per sheet tab so concurrent syncs don't both append the same new row. */
  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  private stateKey(name: SheetsTargetName) {
    return name === 'batches' ? SHEETS_KEYS.batchesState : SHEETS_KEYS.invoicesState;
  }

  private async setState(workspaceId: string, name: SheetsTargetName, patch: SyncState) {
    try {
      const key = this.stateKey(name);
      const prev = await this.prisma.appConfig.findUnique({ where: { workspaceId_key: { workspaceId, key } } });
      const value = { ...((prev?.value as object | null) ?? {}), ...patch } as Prisma.InputJsonValue;
      await this.prisma.appConfig.upsert({
        where: { workspaceId_key: { workspaceId, key } },
        create: { workspaceId, key, value },
        update: { value },
      });
    } catch (err) {
      this.logger.warn(`Could not record sheets sync state: ${(err as Error).message}`);
    }
  }

  private async markSynced(workspaceId: string, name: SheetsTargetName, message: string) {
    const at = new Date().toISOString();
    await this.setState(workspaceId, name, { state: 'SYNCED', at, lastSyncedAt: at, message });
  }

  private async fail(workspaceId: string, name: SheetsTargetName, err: unknown): Promise<SheetsSyncResult> {
    const message = (err as Error)?.message ?? String(err);
    this.logger.error(`Sheets sync (${name}) failed for workspace ${workspaceId}: ${message}`);
    await this.setState(workspaceId, name, { state: 'ERROR', at: new Date().toISOString(), message });
    return { ok: false, status: 'ERROR', message };
  }
}
