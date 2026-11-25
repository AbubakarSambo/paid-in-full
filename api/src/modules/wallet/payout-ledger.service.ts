import { Injectable, Logger } from '@nestjs/common';
import { LedgerStatus, PayoutStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { deriveBatchStatus, deriveLineStatus, toNum } from './payout-math';

export type TransferOutcome = 'SUCCESS' | 'FAILED' | 'REVERSED';

export interface ApplyOutcomeOptions {
  message?: string | null;
  /** false = we could not confirm the outcome with the provider (leaves the line unsafe to re-pay). */
  confirmed?: boolean;
  providerResponse?: unknown;
  source?: string;
}

/**
 * The one place that moves a payout leg to a final state. Used by the Monnify webhook, by
 * "Check status", by background recovery and by the disburse loop itself, so every path
 * applies identical, idempotent transitions:
 *
 *   PENDING/PROCESSING/FAILED(unconfirmed) → SUCCESS | FAILED
 *   SUCCESS (or in flight)                 → REVERSED
 *
 * Each transition also updates the matching wallet ledger entry (in-flight debit → completed,
 * failed or reversed), the WHT ledger, the line (paid/outstanding/status) and the batch status.
 */
@Injectable()
export class PayoutLedgerService {
  private readonly logger = new Logger(PayoutLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async applyTransferOutcome(
    transferReference: string,
    outcome: TransferOutcome,
    opts: ApplyOutcomeOptions = {},
  ): Promise<{ found: boolean; changed: number; batchIds: string[]; paidItemIds?: string[] }> {
    const confirmed = opts.confirmed !== false;
    const result = await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM batch_item_payouts
          WHERE transfer_reference = ${transferReference} OR reference = ${transferReference}
          FOR UPDATE`;
        if (!locked.length) return { found: false, changed: 0, batchIds: [] };

        const legs = await tx.batchItemPayout.findMany({
          where: { id: { in: locked.map((r) => r.id) } },
          include: { batchItem: { select: { id: true, batchId: true, vendorId: true, total: true, whtRate: true } } },
        });

        const now = new Date();
        const touchedItems = new Set<string>();
        const touchedBatches = new Set<string>();
        let changed = 0;

        for (const leg of legs) {
          const next = nextStatus(leg.status, !!leg.statusCheckedAt, outcome, confirmed);
          if (!next) {
            if (outcome === 'SUCCESS' && leg.status === 'FAILED') {
              this.logger.warn(`Leg ${leg.reference} reported SUCCESS after a confirmed failure — applying provider truth`);
            } else {
              continue;
            }
          }
          const status: PayoutStatus = next ?? 'SUCCESS';
          if (status === leg.status && (status !== 'FAILED' || !!leg.statusCheckedAt === confirmed)) continue;

          await tx.batchItemPayout.update({
            where: { id: leg.id },
            data: {
              status,
              failureReason: status === 'SUCCESS' ? null : opts.message ?? leg.failureReason ?? defaultMessage(status),
              completedAt: status === 'PROCESSING' ? null : now,
              statusCheckedAt: confirmed ? now : leg.statusCheckedAt,
              ...(opts.providerResponse !== undefined && {
                providerResponse: JSON.parse(JSON.stringify(opts.providerResponse)) as Prisma.InputJsonValue,
              }),
            },
          });

          const ledgerStatus: LedgerStatus =
            status === 'SUCCESS' ? 'COMPLETED' : status === 'REVERSED' ? 'REVERSED' : confirmed ? 'FAILED' : 'PENDING';
          await tx.walletLedgerEntry.updateMany({
            where: { workspaceId: leg.workspaceId, sourceId: leg.id },
            data: { status: ledgerStatus },
          });

          if (leg.leg === 'WHT') {
            if (status === 'SUCCESS') {
              const d = new Date();
              await tx.whtLedger.upsert({
                where: { reference: leg.reference },
                update: {},
                create: {
                  workspaceId: leg.workspaceId,
                  batchItemId: leg.batchItemId,
                  vendorId: leg.batchItem.vendorId,
                  grossAmount: leg.batchItem.total,
                  whtRate: leg.batchItem.whtRate,
                  whtAmount: leg.amount,
                  taxPeriod: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)),
                  reference: leg.reference,
                  remittedAt: now,
                },
              });
            } else if (status === 'REVERSED') {
              await tx.whtLedger.deleteMany({ where: { reference: leg.reference } });
            }
          }

          changed++;
          touchedItems.add(leg.batchItemId);
          touchedBatches.add(leg.batchItem.batchId);
        }

        // Serialise recomputes per batch: the VENDOR and WHT legs of one line (or two lines of one
        // batch) are confirmed by separate concurrent webhooks, each locking only its own legs. Without
        // this, each transaction recomputes from a snapshot missing the other's uncommitted leg and the
        // last commit leaves the line SENDING with only one leg counted as paid.
        for (const batchId of [...touchedBatches].sort()) {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`payout-recompute:${batchId}`}))::text`;
        }
        const before = new Map(
          (await tx.batchItem.findMany({ where: { id: { in: [...touchedItems] } }, select: { id: true, payoutStatus: true } })).map((i) => [i.id, i.payoutStatus]),
        );
        const paidItemIds: string[] = [];
        for (const itemId of touchedItems) {
          const after = await this.recomputeLine(tx, itemId);
          if (after?.payoutStatus === 'SUCCESS' && before.get(itemId) !== 'SUCCESS') paidItemIds.push(itemId);
        }
        for (const batchId of touchedBatches) await this.recomputeBatch(tx, batchId);
        return { found: true, changed, batchIds: [...touchedBatches], paidItemIds };
      },
      { timeout: 15_000, maxWait: 5_000 },
    );
    // Lovable emailed the queuer and the original requisitor the first time a line became fully paid. Doing it
    // here covers every path (webhook, status check, recovery), and only on the transition, so it never repeats.
    if (result.paidItemIds?.length) void this.notifyPaid(result.paidItemIds);
    return result;
  }

  /** "Payment made" email to the person who queued the line and to its requisitor. Best effort; never throws. */
  async notifyPaid(itemIds: string[]) {
    const money = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 });
    for (const itemId of itemIds) {
      try {
        const item = await this.prisma.batchItem.findUnique({
          where: { id: itemId },
          include: { batch: { select: { batchRef: true, workspace: { select: { name: true } } } } },
        });
        if (!item) continue;
        const requisition = item.requisitionId
          ? await this.prisma.requisition.findUnique({ where: { id: item.requisitionId }, select: { requestedById: true } })
          : null;
        const userIds = [item.createdById, requisition?.requestedById].filter((x): x is string => !!x);
        const users = await this.prisma.user.findMany({
          where: { id: { in: userIds }, isActive: true },
          select: { email: true, displayName: true, firstName: true },
        });
        const recipients = new Map<string, string | undefined>();
        for (const u of users) {
          if (!recipients.has(u.email.toLowerCase())) recipients.set(u.email.toLowerCase(), u.displayName || u.firstName || undefined);
        }
        for (const [to, name] of recipients) {
          await this.email.send(to, 'PAYMENT_MADE', {
            recipientName: name,
            vendorName: item.vendorName,
            amount: money.format(Number(item.total)),
            batchRef: item.batch.batchRef,
            paidAt: new Date().toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }),
            workspaceName: item.batch.workspace.name,
          });
        }
      } catch (error) {
        this.logger.warn(`Payment-made email for item ${itemId} failed: ${(error as Error).message}`);
      }
    }
  }

  /** Re-derives paidAmount / payoutStatus / message for one line from its payout ledger. */
  async recomputeLine(tx: Prisma.TransactionClient, itemId: string) {
    const item = await tx.batchItem.findUnique({ where: { id: itemId }, include: { payouts: true } });
    if (!item) return null;
    const d = deriveLineStatus(item);
    const data: Prisma.BatchItemUpdateInput = { paidAmount: d.paid, payoutStatus: d.status };
    if (d.message !== undefined) data.payoutMessage = d.message;
    if (d.reference) data.payoutReference = d.reference;
    return tx.batchItem.update({ where: { id: itemId }, data });
  }

  async recomputeBatch(tx: Prisma.TransactionClient, batchId: string) {
    const batch = await tx.batch.findUnique({
      where: { id: batchId },
      include: { items: { select: { payoutStatus: true, paidAmount: true } } },
    });
    if (!batch || batch.payoutStatus === 'CANCELLED') return batch;
    const status = deriveBatchStatus(batch.items);
    if (status === batch.payoutStatus) return batch;
    return tx.batch.update({ where: { id: batchId }, data: { payoutStatus: status } });
  }

  /** Sum of SUCCESS legs, for callers that want a figure without a full recompute. */
  static paidOf(legs: Array<{ status: PayoutStatus; amount: Prisma.Decimal | number }>) {
    return legs.filter((l) => l.status === 'SUCCESS').reduce((s, l) => s + toNum(l.amount), 0);
  }
}

function nextStatus(
  current: PayoutStatus,
  checked: boolean,
  outcome: TransferOutcome,
  confirmed: boolean,
): PayoutStatus | null {
  const inFlight = current === 'PENDING' || current === 'PROCESSING';
  switch (outcome) {
    case 'SUCCESS':
      if (inFlight || (current === 'FAILED' && !checked)) return 'SUCCESS';
      return current === 'SUCCESS' ? 'SUCCESS' : null;
    case 'FAILED':
      if (inFlight) return 'FAILED';
      if (current === 'FAILED' && !checked && confirmed) return 'FAILED';
      return null;
    case 'REVERSED':
      if (current === 'SUCCESS' || inFlight) return 'REVERSED';
      return current === 'REVERSED' ? 'REVERSED' : null;
  }
}

function defaultMessage(status: PayoutStatus): string | null {
  if (status === 'FAILED') return 'Declined by Monnify';
  if (status === 'REVERSED') return 'Reversed by the receiving bank';
  return null;
}
