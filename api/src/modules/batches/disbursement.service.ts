import { SheetsService } from '../sheets/sheets.service';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BatchItemPayout, PayoutLeg, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../platform/audit-log.service';
import { AUDIT_ACTIONS, CurrentUserData, runIdempotent } from '../../common';
import { MonnifyService, classifyTransferError } from '../monnify/monnify.service';
import { WalletService, lockWallet } from '../wallet/wallet.service';
import { PayoutLedgerService } from '../wallet/payout-ledger.service';
import {
  NOT_FOUND_GRACE_MS,
  formatNaira,
  hasMissingBank,
  isLegInFlight,
  isLegUnconfirmedFailure,
  kobo,
  lineSafety,
  outstandingOf,
  paidFromLegs,
  round2,
  splitPayment,
  toNum,
} from '../wallet/payout-math';
import { DisburseBatchDto, DisbursePreviewDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';
import { SecurityService } from '../security/security.service';

const CHUNK_SIZE = 5;
const IDEMPOTENCY_ACTION = 'BATCH_DISBURSE';

export interface WhtAccount {
  accountNumber: string;
  bankCode: string;
  accountName: string;
  bankName?: string;
}

interface PlannedTransfer {
  transferReference: string;
  leg: PayoutLeg;
  amount: number;
  destinationAccountNumber: string;
  destinationBankCode: string;
  destinationAccountName: string;
  narration: string;
  itemIds: string[];
}

export interface DisbursePlan {
  batchId: string;
  batchRef: string;
  clientRequestId: string;
  total: number;
  itemIds: string[];
  transfers: PlannedTransfer[];
  skipped: Array<{ itemId: string; vendorName: string; amount: number; message: string }>;
}

export type LineResultLabel = 'PAID' | 'FAILED' | 'SKIPPED' | 'AWAITING_CONFIRMATION';

const RESULT_TEXT: Record<LineResultLabel, string> = {
  PAID: 'Paid',
  FAILED: 'Failed — not paid',
  SKIPPED: 'Skipped — missing bank details',
  AWAITING_CONFIRMATION: 'Awaiting confirmation',
};

type ItemWithPayouts = Prisma.BatchItemGetPayload<{ include: { payouts: true } }>;

/** Reads the WHT destination account from AppConfig (`wht_account` object or `wht_account_*` keys). */
export async function getWhtAccount(db: Prisma.TransactionClient | PrismaService, workspaceId: string): Promise<WhtAccount | null> {
  const rows = await db.appConfig.findMany({ where: { workspaceId, key: { startsWith: 'wht_account' } } });
  const map = new Map(rows.map((r) => [r.key, r.value as unknown]));
  const obj = (map.get('wht_account') ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = map.get(k) ?? obj[k.replace(/^wht_account_/, '')] ?? obj[camel(k.replace(/^wht_account_/, ''))];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return undefined;
  };
  const accountNumber = pick('wht_account_number', 'wht_account_acct_no', 'wht_account_account_number');
  const bankCode = pick('wht_account_bank_code');
  if (!accountNumber || !bankCode) return null;
  return {
    accountNumber,
    bankCode,
    accountName: pick('wht_account_name', 'wht_account_account_name') ?? 'WHT Account',
    bankName: pick('wht_account_bank_name', 'wht_account_bank'),
  };
}

function camel(s: string) {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function refFor(clientRequestId: string, leg: PayoutLeg, key: string): string {
  return `PIF${createHash('sha256').update(`${clientRequestId}|${leg}|${key}`).digest('hex').slice(0, 24).toUpperCase()}`;
}

class ShortfallError extends BadRequestException {
  constructor(
    public readonly needed: number,
    public readonly available: number,
    public readonly clearing: number,
  ) {
    super(
      `${formatNaira(round2(needed - available))} short — this will not go through yet. Ready to send: ${formatNaira(available)}${
        clearing > 0 ? ` (plus ${formatNaira(clearing)} clearing)` : ''
      }.`,
    );
  }
}

/**
 * Spec §5.3 "Disburse to Vendors" + §8 money movement.
 *
 * Phase A (one DB transaction, under the batch row lock and the workspace wallet lock, wrapped in
 * runIdempotent): validate the selection, check "ready to send", write every payout leg as
 * PENDING with a deterministic reference plus an in-flight wallet debit, mark lines SENDING.
 * Phase B: send the transfers in chunks. Each transfer is first *claimed* (PENDING → PROCESSING
 * conditional update) so two workers can never send the same leg.
 * Recovery: a retry with the same clientRequestId replays the stored plan; legs already claimed
 * are never re-sent, unclaimed legs are status-checked with Monnify before sending. The final
 * answer is always read back from the BatchItemPayout ledger.
 */
@Injectable()
export class DisbursementService {
  private readonly logger = new Logger(DisbursementService.name);
  private recovering = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly monnify: MonnifyService,
    private readonly wallet: WalletService,
    private readonly ledger: PayoutLedgerService,
    private readonly security: SecurityService,
    private readonly notifications: NotificationsService,
    private readonly sheets: SheetsService,
  ) {}

  // ─── Preview ──────────────────────────────────────────────────────────────

  async preview(workspaceId: string, batchId: string, dto: DisbursePreviewDto) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, workspaceId },
      include: { items: { include: { payouts: true } } },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    const [whtAccount, balance] = await Promise.all([getWhtAccount(this.prisma, workspaceId), this.wallet.getBalance(workspaceId)]);
    const evaluation = this.evaluate(batch.items, dto, whtAccount, false);
    const shortBy = round2(Math.max(0, evaluation.total - balance.readyToSend));
    return {
      batchId,
      batchRef: batch.batchRef,
      lines: evaluation.lines,
      total: evaluation.total,
      whtTotal: evaluation.whtTotal,
      transfers: evaluation.transferCount,
      whtAccountConfigured: !!whtAccount,
      readyToSend: balance.readyToSend,
      clearing: balance.clearing,
      shortBy,
      shortMessage: shortBy > 0 ? `${formatNaira(shortBy)} short — this will not go through yet` : null,
      errors: evaluation.errors,
      canSubmit: evaluation.errors.length === 0 && shortBy === 0 && evaluation.total > 0,
    };
  }

  /** Validates the requested lines against the ledger and computes each line's legs. */
  private evaluate(items: ItemWithPayouts[], dto: DisbursePreviewDto, whtAccount: WhtAccount | null, strict: boolean) {
    const byId = new Map(items.map((i) => [i.id, i]));
    const seen = new Set<string>();
    const errors: string[] = [];
    const lines: Array<{
      itemId: string;
      vendorName: string;
      outstanding: number;
      amount: number;
      vendorLeg: number;
      whtLeg: number;
      status: 'OK' | 'SKIPPED' | 'BLOCKED';
      message?: string;
    }> = [];

    for (const req of dto.lines) {
      if (seen.has(req.itemId)) {
        errors.push(`Line ${req.itemId} is listed twice`);
        continue;
      }
      seen.add(req.itemId);
      const item = byId.get(req.itemId);
      if (!item) {
        errors.push(`Line ${req.itemId} is not in this batch`);
        continue;
      }
      const safety = lineSafety(item);
      const outstanding = outstandingOf(item.total, paidFromLegs(item.payouts));
      if (!safety.selectable) {
        lines.push({ itemId: item.id, vendorName: item.vendorName, outstanding, amount: 0, vendorLeg: 0, whtLeg: 0, status: 'BLOCKED', message: safety.reason });
        errors.push(`${item.vendorName}: ${safety.reason}`);
        continue;
      }
      const amount = round2(req.amount ?? outstanding);
      if (amount <= 0 || kobo(amount) > kobo(outstanding)) {
        lines.push({ itemId: item.id, vendorName: item.vendorName, outstanding, amount, vendorLeg: 0, whtLeg: 0, status: 'BLOCKED', message: `Amount must be between ₦0.01 and the outstanding ${formatNaira(outstanding)}` });
        errors.push(`${item.vendorName}: amount must not exceed the outstanding ${formatNaira(outstanding)}`);
        continue;
      }
      if (hasMissingBank(item)) {
        lines.push({ itemId: item.id, vendorName: item.vendorName, outstanding, amount, vendorLeg: 0, whtLeg: 0, status: 'SKIPPED', message: 'Skipped — missing bank details (no bank code or account number)' });
        continue;
      }
      const legs = splitPayment(item, amount);
      if (legs.wht > 0 && !whtAccount) {
        lines.push({ itemId: item.id, vendorName: item.vendorName, outstanding, amount, ...{ vendorLeg: legs.vendor, whtLeg: legs.wht }, status: 'BLOCKED', message: 'WHT payments are blocked until a WHT destination account is set in Settings' });
        errors.push(`${item.vendorName}: WHT payments are blocked until a WHT destination account is set in Settings`);
        continue;
      }
      lines.push({ itemId: item.id, vendorName: item.vendorName, outstanding, amount, vendorLeg: legs.vendor, whtLeg: legs.wht, status: 'OK' });
    }

    const ok = lines.filter((l) => l.status === 'OK');
    const total = round2(ok.reduce((s, l) => s + l.amount, 0));
    const whtTotal = round2(ok.reduce((s, l) => s + l.whtLeg, 0));
    const groups = new Set<string>();
    for (const l of ok) {
      const item = byId.get(l.itemId)!;
      const key = dto.aggregateByVendor ? `${item.vendorBankCode}|${item.vendorAcctNo}` : l.itemId;
      if (l.vendorLeg > 0) groups.add(`V|${key}`);
      if (l.whtLeg > 0) groups.add(`W|${key}`);
    }
    if (strict && errors.length) throw new BadRequestException({ message: 'Some lines cannot be paid', errors, lines });
    return { lines, total, whtTotal, errors, transferCount: groups.size };
  }

  // ─── Disburse ─────────────────────────────────────────────────────────────

  async disburse(user: CurrentUserData, batchId: string, dto: DisburseBatchDto) {
    const workspaceId = user.workspaceId;
    await this.security.assertDisbursementAuth(user, { pin: dto.pin, password: dto.password });

    let fresh = false;
    let plan: DisbursePlan;
    try {
      plan = await runIdempotent(this.prisma, workspaceId, IDEMPOTENCY_ACTION, dto.clientRequestId, async (tx) => {
        const built = await this.buildAndPersistPlan(tx, user, batchId, dto);
        fresh = true;
        return built;
      });
    } catch (error) {
      if (error instanceof ShortfallError) {
        await this.prisma.payoutFundingWait.create({
          data: { workspaceId, batchId, requiredAmount: error.needed, availableAmount: error.available, status: 'WAITING' },
        });
      }
      throw error;
    }
    if (plan.batchId !== batchId) throw new BadRequestException('This clientRequestId was already used for another batch');

    await this.sendTransfers(plan, !fresh);
    const result = await this.resolveResult(workspaceId, plan);
    if (fresh) void this.notifyResult(workspaceId, result);
    void this.sheets.syncBatch(workspaceId, batchId); // spec §9: sync on disbursement (never throws)
    return { ...result, recovered: !fresh };
  }

  private async buildAndPersistPlan(
    tx: Prisma.TransactionClient,
    user: CurrentUserData,
    batchId: string,
    dto: DisburseBatchDto,
  ): Promise<DisbursePlan> {
    const workspaceId = user.workspaceId;
    await lockWallet(tx, workspaceId);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM batches WHERE id = ${batchId} AND workspace_id = ${workspaceId} FOR UPDATE`;
    if (!locked.length) throw new NotFoundException('Batch not found');

    const batch = await tx.batch.findUniqueOrThrow({ where: { id: batchId }, include: { items: { include: { payouts: true } } } });
    if (batch.payoutStatus === 'CANCELLED') throw new BadRequestException('This batch is cancelled');

    const whtAccount = await getWhtAccount(tx, workspaceId);
    const evaluation = this.evaluate(batch.items, dto, whtAccount, true);
    if (kobo(dto.typedTotal) !== kobo(evaluation.total)) {
      throw new BadRequestException(`Typed total does not match the total to disburse (${formatNaira(evaluation.total)})`);
    }
    if (evaluation.total <= 0 && !evaluation.lines.some((l) => l.status === 'SKIPPED')) {
      throw new BadRequestException('Nothing to disburse');
    }

    const balance = await this.wallet.computeBalance(tx, workspaceId);
    if (evaluation.total > balance.readyToSend) {
      throw new ShortfallError(evaluation.total, balance.readyToSend, balance.clearing);
    }

    const byId = new Map(batch.items.map((i) => [i.id, i]));
    const now = new Date();

    // Skipped lines: no legs, status SKIPPED with a message.
    const skipped: DisbursePlan['skipped'] = [];
    for (const l of evaluation.lines.filter((x) => x.status === 'SKIPPED')) {
      skipped.push({ itemId: l.itemId, vendorName: l.vendorName, amount: l.amount, message: l.message! });
      await tx.batchItem.update({ where: { id: l.itemId }, data: { payoutStatus: 'SKIPPED', payoutMessage: l.message } });
    }

    // Group legs into transfers.
    type Member = { itemId: string; amount: number };
    const groups = new Map<string, { leg: PayoutLeg; key: string; members: Member[]; dest: { no: string; code: string; name: string }; vendorName: string }>();
    for (const l of evaluation.lines.filter((x) => x.status === 'OK')) {
      const item = byId.get(l.itemId)!;
      const vendorKey = dto.aggregateByVendor ? `${item.vendorBankCode}|${item.vendorAcctNo}` : item.id;
      if (l.vendorLeg > 0) {
        const k = `VENDOR|${vendorKey}`;
        const g = groups.get(k) ?? {
          leg: 'VENDOR' as PayoutLeg,
          key: vendorKey,
          members: [],
          dest: { no: item.vendorAcctNo!, code: item.vendorBankCode!, name: item.vendorAcctName ?? item.vendorName },
          vendorName: item.vendorName,
        };
        g.members.push({ itemId: item.id, amount: l.vendorLeg });
        groups.set(k, g);
      }
      if (l.whtLeg > 0 && whtAccount) {
        const k = `WHT|${vendorKey}`;
        const g = groups.get(k) ?? {
          leg: 'WHT' as PayoutLeg,
          key: vendorKey,
          members: [],
          dest: { no: whtAccount.accountNumber, code: whtAccount.bankCode, name: whtAccount.accountName },
          vendorName: item.vendorName,
        };
        g.members.push({ itemId: item.id, amount: l.whtLeg });
        groups.set(k, g);
      }
    }

    const transfers: PlannedTransfer[] = [];
    const payoutRows: Prisma.BatchItemPayoutCreateManyInput[] = [];
    const ledgerRows: Array<{ id: string; amount: number; leg: PayoutLeg; reference: string; narration: string }> = [];
    for (const g of groups.values()) {
      const transferReference = refFor(dto.clientRequestId, g.leg, g.key);
      const amount = round2(g.members.reduce((s, m) => s + m.amount, 0));
      const narration = `${g.leg === 'WHT' ? 'WHT ' : ''}${batch.batchRef} ${g.vendorName}`.slice(0, 100);
      transfers.push({
        transferReference,
        leg: g.leg,
        amount,
        destinationAccountNumber: g.dest.no,
        destinationBankCode: g.dest.code,
        destinationAccountName: g.dest.name,
        narration,
        itemIds: g.members.map((m) => m.itemId),
      });
      g.members.forEach((m, i) => {
        const id = randomUUID();
        const reference = g.members.length === 1 ? transferReference : `${transferReference}-${i + 1}`;
        payoutRows.push({
          id,
          workspaceId,
          batchItemId: m.itemId,
          leg: g.leg,
          amount: m.amount,
          status: 'PENDING',
          reference,
          transferReference,
          clientRequestId: dto.clientRequestId,
          destinationAccountNumber: g.dest.no,
          destinationBankCode: g.dest.code,
          destinationAccountName: g.dest.name,
          initiatedById: user.id,
        });
        ledgerRows.push({ id, amount: m.amount, leg: g.leg, reference, narration });
      });
    }

    if (payoutRows.length) await tx.batchItemPayout.createMany({ data: payoutRows });
    for (const r of ledgerRows) {
      await this.wallet.postEntry(tx, workspaceId, {
        direction: 'OUT',
        status: 'PENDING',
        amount: r.amount,
        type: r.leg === 'WHT' ? 'WHT_WITHHOLDING' : 'DISBURSEMENT',
        reference: r.reference,
        sourceType: r.leg === 'WHT' ? 'wht' : 'payout',
        sourceId: r.id,
        batchId,
        description: r.narration,
        actorUserId: user.id,
      });
    }
    const sendingIds = [...new Set(payoutRows.map((p) => p.batchItemId))];
    if (sendingIds.length) {
      await tx.batchItem.updateMany({ where: { id: { in: sendingIds } }, data: { payoutStatus: 'SENDING', payoutMessage: null } });
    }
    for (const id of sendingIds) await this.ledger.recomputeLine(tx, id);
    if (sendingIds.length) await tx.batch.update({ where: { id: batchId }, data: { disbursedAt: now } });
    await this.ledger.recomputeBatch(tx, batchId);
    await tx.payoutFundingWait.updateMany({
      where: { workspaceId, batchId, status: 'WAITING' },
      data: { status: 'FUNDED', availableAmount: balance.readyToSend, resolvedAt: now },
    });

    await this.audit.recordTx(tx, workspaceId, user, AUDIT_ACTIONS.BATCH_DISBURSE_INITIATED, batch.batchRef, {
      clientRequestId: dto.clientRequestId,
      total: evaluation.total,
      lines: sendingIds.length,
      skipped: skipped.length,
      transfers: transfers.length,
      aggregateByVendor: !!dto.aggregateByVendor,
    }, { type: 'batch', id: batchId });

    return {
      batchId,
      batchRef: batch.batchRef,
      clientRequestId: dto.clientRequestId,
      total: evaluation.total,
      itemIds: evaluation.lines.filter((l) => l.status !== 'BLOCKED').map((l) => l.itemId),
      transfers,
      skipped,
    };
  }

  /** Phase B: send in chunks ("secure groups"). Never throws for a single transfer's failure. */
  private async sendTransfers(plan: DisbursePlan, recovery: boolean) {
    for (let i = 0; i < plan.transfers.length; i += CHUNK_SIZE) {
      const chunk = plan.transfers.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map((t) => this.sendOne(t, recovery).catch((e) => this.logger.error(`Transfer ${t.transferReference}: ${(e as Error).message}`))));
    }
  }

  private async sendOne(t: PlannedTransfer, recovery: boolean) {
    const claim = await this.prisma.batchItemPayout.updateMany({
      where: { transferReference: t.transferReference, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    if (claim.count === 0) return; // already sent / resolved by another worker

    if (recovery) {
      try {
        const st = await this.monnify.getTransferStatus(t.transferReference);
        if (st.status !== 'NOT_FOUND') {
          if (st.status !== 'PENDING') {
            await this.ledger.applyTransferOutcome(t.transferReference, st.status, { message: st.message, source: 'recovery' });
          }
          return;
        }
      } catch (error) {
        await this.noteOnLegs(t.transferReference, `Status unknown after interruption — use Check status (${(error as Error).message})`);
        return;
      }
    }

    try {
      const res = await this.monnify.initiateSingleTransfer({
        amount: t.amount,
        reference: t.transferReference,
        narration: t.narration,
        destinationAccountNumber: t.destinationAccountNumber,
        destinationBankCode: t.destinationBankCode,
        destinationAccountName: t.destinationAccountName,
      });
      await this.prisma.batchItemPayout.updateMany({
        where: { transferReference: t.transferReference },
        data: { providerResponse: JSON.parse(JSON.stringify(res.raw ?? { status: res.status })) as Prisma.InputJsonValue },
      });
      if (res.status === 'SUCCESS' || res.status === 'FAILED') {
        await this.ledger.applyTransferOutcome(t.transferReference, res.status, { message: res.message, source: 'initiate' });
      }
    } catch (error) {
      const kind = classifyTransferError(error);
      const message = (error as Error).message;
      if (kind === 'NOT_SENT') {
        await this.ledger.applyTransferOutcome(t.transferReference, 'FAILED', { message, source: 'initiate' });
      } else if (kind === 'DUPLICATE') {
        await this.noteOnLegs(t.transferReference, 'Already submitted to Monnify — awaiting confirmation');
      } else {
        // Outcome unknown: keep the leg in flight (locked) until a status check resolves it.
        await this.noteOnLegs(t.transferReference, `No answer from Monnify — awaiting confirmation (${message})`);
      }
    }
  }

  private async noteOnLegs(transferReference: string, note: string) {
    await this.prisma.batchItemPayout.updateMany({ where: { transferReference, status: { in: ['PENDING', 'PROCESSING'] } }, data: { failureReason: note } });
  }

  /** Per-line outcome of one disburse request, read from the payout ledger. */
  async resolveResult(workspaceId: string, plan: DisbursePlan) {
    const legs = await this.prisma.batchItemPayout.findMany({
      where: { workspaceId, clientRequestId: plan.clientRequestId },
      include: { batchItem: { select: { id: true, vendorName: true, description: true, payoutMessage: true } } },
    });
    const byItem = new Map<string, typeof legs>();
    for (const l of legs) byItem.set(l.batchItemId, [...(byItem.get(l.batchItemId) ?? []), l]);

    const lines: Array<{
      itemId: string;
      vendorName: string;
      description?: string;
      amount: number;
      result: LineResultLabel;
      label: string;
      message?: string | null;
      references: string[];
    }> = [];
    for (const [itemId, ls] of byItem) {
      const amount = round2(ls.reduce((s, l) => s + toNum(l.amount), 0));
      let result: LineResultLabel;
      if (ls.some(isLegInFlight)) result = 'AWAITING_CONFIRMATION';
      else if (ls.some((l) => l.status === 'FAILED' || l.status === 'REVERSED')) result = 'FAILED';
      else result = 'PAID';
      const failed = ls.find((l) => l.status === 'FAILED' || l.status === 'REVERSED');
      const awaiting = ls.find(isLegInFlight);
      lines.push({
        itemId,
        vendorName: ls[0].batchItem.vendorName,
        description: ls[0].batchItem.description,
        amount,
        result,
        label: RESULT_TEXT[result],
        message:
          result === 'FAILED'
            ? `${failed?.leg === 'WHT' ? 'WHT leg: ' : ''}${failed?.failureReason ?? 'Declined'}${failed && isLegUnconfirmedFailure(failed) ? ' (check status before retrying)' : ''}`
            : result === 'AWAITING_CONFIRMATION'
              ? awaiting?.failureReason ?? 'Sent — waiting for Monnify to confirm'
              : null,
        references: [...new Set(ls.map((l) => l.transferReference ?? l.reference))],
      });
    }
    for (const s of plan.skipped) {
      lines.push({ itemId: s.itemId, vendorName: s.vendorName, amount: s.amount, result: 'SKIPPED', label: RESULT_TEXT.SKIPPED, message: s.message, references: [] });
    }

    const count = (r: LineResultLabel) => lines.filter((l) => l.result === r).length;
    const sum = (r: LineResultLabel) => round2(lines.filter((l) => l.result === r).reduce((s, l) => s + l.amount, 0));
    const batch = await this.prisma.batch.findUnique({ where: { id: plan.batchId }, select: { payoutStatus: true } });
    return {
      batchId: plan.batchId,
      batchRef: plan.batchRef,
      clientRequestId: plan.clientRequestId,
      total: plan.total,
      batchStatus: batch?.payoutStatus,
      complete: count('AWAITING_CONFIRMATION') === 0,
      summary: {
        paid: count('PAID'),
        paidAmount: sum('PAID'),
        failed: count('FAILED'),
        failedAmount: sum('FAILED'),
        skipped: count('SKIPPED'),
        awaiting: count('AWAITING_CONFIRMATION'),
        awaitingAmount: sum('AWAITING_CONFIRMATION'),
      },
      lines,
    };
  }

  /** GET recovery endpoint: the true outcome of an earlier (possibly interrupted) request. */
  async getRequestResult(workspaceId: string, batchId: string, clientRequestId: string) {
    const key = await this.prisma.idempotencyKey.findUnique({
      where: { workspaceId_action_key: { workspaceId, action: IDEMPOTENCY_ACTION, key: clientRequestId } },
    });
    if (!key?.resultSnapshot) {
      return { batchId, clientRequestId, found: false, message: 'No disbursement was recorded for this request — nothing was sent.' };
    }
    const plan = key.resultSnapshot as unknown as DisbursePlan;
    if (plan.batchId !== batchId) throw new NotFoundException('This request belongs to another batch');
    return { found: true, ...(await this.resolveResult(workspaceId, plan)) };
  }

  // ─── Check status / recovery / retry ──────────────────────────────────────

  /** "Check status": re-query Monnify for every unresolved leg of the batch. */
  async checkStatus(workspaceId: string, batchId: string) {
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, workspaceId }, select: { id: true } });
    if (!batch) throw new NotFoundException('Batch not found');
    const legs = await this.prisma.batchItemPayout.findMany({
      where: {
        workspaceId,
        batchItem: { batchId },
        OR: [{ status: { in: ['PENDING', 'PROCESSING'] } }, { status: 'FAILED', statusCheckedAt: null }],
      },
    });
    const resolved = await this.resolveLegs(legs);
    void this.sheets.syncBatch(workspaceId, batchId);
    return resolved;
  }

  private async resolveLegs(legs: BatchItemPayout[]) {
    const byRef = new Map<string, BatchItemPayout[]>();
    for (const l of legs) {
      const ref = l.transferReference ?? l.reference;
      byRef.set(ref, [...(byRef.get(ref) ?? []), l]);
    }
    const tally = { checked: byRef.size, success: 0, failed: 0, reversed: 0, pending: 0, errors: 0 };
    const entries = [...byRef.entries()];
    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      await Promise.all(
        entries.slice(i, i + CHUNK_SIZE).map(async ([ref, ls]) => {
          try {
            const st = await this.monnify.getTransferStatus(ref);
            if (st.status === 'SUCCESS' || st.status === 'FAILED' || st.status === 'REVERSED') {
              await this.ledger.applyTransferOutcome(ref, st.status, { message: st.message, source: 'status_check' });
              tally[st.status === 'SUCCESS' ? 'success' : st.status === 'FAILED' ? 'failed' : 'reversed']++;
            } else if (st.status === 'NOT_FOUND' && ls.every((l) => Date.now() - l.updatedAt.getTime() > NOT_FOUND_GRACE_MS)) {
              await this.ledger.applyTransferOutcome(ref, 'FAILED', {
                message: 'Monnify has no record of this transfer — it was not sent',
                source: 'status_check',
              });
              tally.failed++;
            } else {
              tally.pending++;
            }
          } catch (error) {
            tally.errors++;
            this.logger.warn(`Status check for ${ref} failed: ${(error as Error).message}`);
          }
        }),
      );
    }
    return tally;
  }

  /** Automatic background recovery (spec §8): resolve legs that have been in flight > 2 minutes. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async recoverInFlight() {
    if (this.recovering) return;
    this.recovering = true;
    try {
      const legs = await this.prisma.batchItemPayout.findMany({
        where: {
          updatedAt: { lt: new Date(Date.now() - NOT_FOUND_GRACE_MS) },
          OR: [{ status: { in: ['PENDING', 'PROCESSING'] } }, { status: 'FAILED', statusCheckedAt: null }],
          NOT: { reference: { startsWith: 'STMT-' } },
        },
        take: 200,
        orderBy: { updatedAt: 'asc' },
      });
      if (legs.length) {
        const tally = await this.resolveLegs(legs);
        this.logger.log(`Background payout recovery: ${JSON.stringify(tally)}`);
      }
    } catch (error) {
      this.logger.error(`Background payout recovery failed: ${(error as Error).message}`);
    } finally {
      this.recovering = false;
    }
  }

  /** "Retry" / "Retry all (N)": reset failed lines so they can be paid in the next disbursement. */
  async retry(user: CurrentUserData, batchId: string, itemIds?: string[]) {
    const workspaceId = user.workspaceId;
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, workspaceId }, select: { id: true, batchRef: true, payoutStatus: true } });
    if (!batch) throw new NotFoundException('Batch not found');
    if (batch.payoutStatus === 'CANCELLED') throw new BadRequestException('This batch is cancelled');

    const where: Prisma.BatchItemWhereInput = { batchId, payoutStatus: { in: ['FAILED', 'REVERSED'] }, ...(itemIds?.length && { id: { in: itemIds } }) };
    // Failures we never confirmed with Monnify are checked first: the money may have gone out.
    const unconfirmed = await this.prisma.batchItemPayout.findMany({ where: { batchItem: where, status: 'FAILED', statusCheckedAt: null } });
    if (unconfirmed.length) await this.resolveLegs(unconfirmed);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM batches WHERE id = ${batchId} FOR UPDATE`;
      const items = await tx.batchItem.findMany({ where, include: { payouts: true } });
      const reset: string[] = [];
      const blocked: Array<{ itemId: string; reason?: string }> = [];
      for (const item of items) {
        const safety = lineSafety(item);
        if (!safety.selectable) {
          blocked.push({ itemId: item.id, reason: safety.reason });
          continue;
        }
        await tx.batchItem.update({ where: { id: item.id }, data: { payoutStatus: 'PENDING', retriedAt: new Date(), payoutMessage: 'Reset for retry' } });
        reset.push(item.id);
      }
      await this.ledger.recomputeBatch(tx, batchId);
      return { reset, blocked };
    });
    if (result.reset.length) {
      await this.audit.record(workspaceId, user, 'batch.lines_retry_reset', batch.batchRef, { items: result.reset }, { type: 'batch', id: batchId });
    }
    return { reset: result.reset.length, itemIds: result.reset, blocked: result.blocked };
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  private async notifyResult(workspaceId: string, result: Awaited<ReturnType<DisbursementService['resolveResult']>>) {
    const s = result.summary;
    await this.notifications.notify(workspaceId, 'disbursement_result', {
      title: `${result.batchRef}: disbursement ${result.complete ? 'complete' : 'sent — awaiting confirmation'}`,
      body: `${s.paid} paid (${formatNaira(s.paidAmount)}), ${s.failed} failed, ${s.skipped} skipped, ${s.awaiting} awaiting confirmation`,
      url: `/app?tab=batches&batch=${result.batchId}`,
    });
  }
}
