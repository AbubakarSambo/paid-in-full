import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Spec §5.7 spend: batch lines + pending queue items whose P&L period falls in the month, for that
 * BU and COA tag. Failed and cancelled payouts are excluded (as are lines in cancelled batches and
 * lines returned to the queue, which reappear as pending queue items).
 *
 * Shared by the budgets screen, the variance report, the queue lane over-budget badge and the
 * approve-flow budget pre-check.
 */

type DbClient = Prisma.TransactionClient | PrismaService;

export interface SpendFilter {
  periods: string[];
  coaTagIds?: string[];
  /** undefined = every BU; null = only lines without a BU; string = that BU. */
  costCenterId?: string | null;
  /** Pending queue items to leave out (e.g. the selection being approved). */
  excludeQueueItemIds?: string[];
}

export function spendKey(costCenterId: string | null | undefined, periodMonth: string, coaTagId: string): string {
  return `${costCenterId ?? '∅'}|${periodMonth}|${coaTagId}`;
}

export const BATCH_SPEND_WHERE: Prisma.BatchItemWhereInput = {
  payoutStatus: { notIn: ['FAILED', 'CANCELLED'] },
  returnedAt: null,
};

/** Map of spendKey(bu, period, coa) → spend. */
export async function computeSpend(
  client: DbClient,
  workspaceId: string,
  filter: SpendFilter,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (filter.periods.length === 0) return result;
  if (filter.coaTagIds && filter.coaTagIds.length === 0) return result;

  const common = {
    pnlPeriod: { in: filter.periods },
    ...(filter.coaTagIds ? { coaTagId: { in: filter.coaTagIds } } : { coaTagId: { not: null } }),
    ...(filter.costCenterId !== undefined && { costCenterId: filter.costCenterId }),
  };

  const [queueGroups, batchGroups] = await Promise.all([
    client.queueItem.groupBy({
      by: ['costCenterId', 'pnlPeriod', 'coaTagId'],
      where: {
        workspaceId,
        status: 'PENDING',
        ...common,
        ...(filter.excludeQueueItemIds?.length && { id: { notIn: filter.excludeQueueItemIds } }),
      },
      _sum: { total: true },
    }),
    client.batchItem.groupBy({
      by: ['costCenterId', 'pnlPeriod', 'coaTagId'],
      where: {
        batch: { workspaceId, payoutStatus: { not: 'CANCELLED' } },
        ...BATCH_SPEND_WHERE,
        ...common,
      },
      _sum: { total: true },
    }),
  ]);

  for (const g of [...queueGroups, ...batchGroups]) {
    if (!g.coaTagId || !g.pnlPeriod) continue;
    const key = spendKey(g.costCenterId, g.pnlPeriod, g.coaTagId);
    result.set(key, (result.get(key) ?? 0) + Number(g._sum.total ?? 0));
  }
  return result;
}
