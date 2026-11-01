import { BatchItemPayoutStatus, PayoutLeg, PayoutStatus, Prisma } from '@prisma/client';

/**
 * Pure helpers shared by batches, disbursement, webhook handling and reconciliation.
 *
 * Accounting model (spec §5.3 / §8):
 * - A batch line's `total` is the gross amount owed. It is paid by one or more payout legs
 *   (BatchItemPayout): VENDOR legs carry the net, WHT legs carry the tax, and STMT-/MANUAL-
 *   legs record money paid outside the app. `paidAmount` = sum of SUCCESS legs (always
 *   recomputed from the ledger, never incremented blindly).
 * - outstanding = total − paid, treated as 0 when paid ≥ total − 0.5.
 */

export const PAID_TOLERANCE = 0.5;
/** A NOT_FOUND status answer only proves "never sent" once the leg has been quiet this long. */
export const NOT_FOUND_GRACE_MS = 2 * 60 * 1000;

export type Num = Prisma.Decimal | number | string | null | undefined;

export function toNum(val: Num): number {
  if (val === null || val === undefined) return 0;
  return typeof val === 'number' ? val : Number(val);
}

export function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function kobo(val: number): number {
  return Math.round(val * 100);
}

export function outstandingOf(total: Num, paid: Num): number {
  const t = toNum(total);
  const p = toNum(paid);
  if (p >= t - PAID_TOLERANCE) return 0;
  return round2(t - p);
}

export interface LegLike {
  id?: string;
  leg: PayoutLeg;
  amount: Num;
  status: PayoutStatus;
  reference: string;
  transferReference?: string | null;
  statusCheckedAt?: Date | null;
  failureReason?: string | null;
  completedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface LineLike {
  id: string;
  total: Num;
  whtAmount: Num;
  paidAmount: Num;
  payoutStatus: BatchItemPayoutStatus;
  vendorBankCode?: string | null;
  vendorAcctNo?: string | null;
  retriedAt?: Date | null;
  payouts: LegLike[];
}

export const isLegInFlight = (l: LegLike) => l.status === 'PENDING' || l.status === 'PROCESSING';
export const isLegUnconfirmedFailure = (l: LegLike) => l.status === 'FAILED' && !l.statusCheckedAt;

export function paidFromLegs(legs: LegLike[]): number {
  return round2(legs.filter((l) => l.status === 'SUCCESS').reduce((s, l) => s + toNum(l.amount), 0));
}

export function legSum(legs: LegLike[], leg: PayoutLeg, statuses: PayoutStatus[]): number {
  return round2(legs.filter((l) => l.leg === leg && statuses.includes(l.status)).reduce((s, l) => s + toNum(l.amount), 0));
}

export function hasMissingBank(line: Pick<LineLike, 'vendorBankCode' | 'vendorAcctNo'>): boolean {
  return !line.vendorBankCode || !line.vendorAcctNo;
}

export interface LineSafety {
  selectable: boolean;
  reason?: string;
}

/**
 * Spec §5.3: lines that are unsafe (in flight, or failed without a status check) can't be selected.
 * Failed (confirmed) and reversed lines become selectable again.
 */
export function lineSafety(line: LineLike): LineSafety {
  if (line.payoutStatus === 'CANCELLED') return { selectable: false, reason: 'Line is cancelled' };
  if (line.payouts.some(isLegInFlight)) return { selectable: false, reason: 'A transfer for this line is still in flight' };
  if (line.payouts.some(isLegUnconfirmedFailure)) {
    return { selectable: false, reason: 'Failed without a status check: run Check status before paying again' };
  }
  const paid = paidFromLegs(line.payouts);
  if (outstandingOf(line.total, paid) <= 0) return { selectable: false, reason: 'Already paid' };
  return { selectable: true };
}

/**
 * Splits a gross payment of `amount` on a line into its VENDOR (net) and WHT legs.
 * The final payment (amount covers the outstanding) settles exactly the WHT still owed, so the
 * legs always add up to the line's whtAmount / netAmount across several partial payments.
 */
export function splitPayment(line: LineLike, amount: number): { vendor: number; wht: number } {
  const total = toNum(line.total);
  const whtTotal = toNum(line.whtAmount);
  const paid = paidFromLegs(line.payouts);
  const outstanding = outstandingOf(total, paid);
  if (whtTotal <= 0 || total <= 0) return { vendor: round2(amount), wht: 0 };

  const whtPaid = legSum(line.payouts, 'WHT', ['SUCCESS']);
  const whtRemaining = Math.max(0, round2(whtTotal - whtPaid));
  let wht: number;
  if (amount >= outstanding - PAID_TOLERANCE) {
    wht = whtRemaining;
  } else {
    wht = Math.min(whtRemaining, Math.round((amount * whtTotal) / total));
  }
  wht = Math.min(wht, round2(amount));
  return { vendor: round2(amount - wht), wht: round2(wht) };
}

/** Status derivation for a line from its payout ledger (see PayoutLedgerService.recomputeLine). */
export function deriveLineStatus(line: LineLike): {
  status: BatchItemPayoutStatus;
  paid: number;
  message?: string | null;
  reference?: string | null;
} {
  const legs = line.payouts;
  const paid = paidFromLegs(legs);
  const latestSuccess = [...legs]
    .filter((l) => l.status === 'SUCCESS')
    .sort((a, b) => time(b) - time(a))[0];
  const reference = latestSuccess ? latestSuccess.transferReference ?? latestSuccess.reference : undefined;

  if (line.payoutStatus === 'CANCELLED') return { status: 'CANCELLED', paid, reference };
  if (legs.some(isLegInFlight)) return { status: 'SENDING', paid, message: null, reference };
  if (outstandingOf(line.total, paid) <= 0) return { status: 'SUCCESS', paid, message: null, reference };

  const lastTerminal = [...legs]
    .filter((l) => l.status === 'FAILED' || l.status === 'REVERSED')
    .sort((a, b) => time(b) - time(a))[0];
  if (lastTerminal && (!line.retriedAt || time(lastTerminal) > line.retriedAt.getTime())) {
    const label = lastTerminal.leg === 'WHT' ? 'WHT transfer' : 'Transfer';
    if (lastTerminal.status === 'REVERSED') {
      return { status: 'REVERSED', paid, message: `${label} reversed${lastTerminal.failureReason ? `: ${lastTerminal.failureReason}` : ''}`, reference };
    }
    const unchecked = !lastTerminal.statusCheckedAt ? ' (check status before retrying)' : '';
    return {
      status: 'FAILED',
      paid,
      message: `${label} failed — not paid${lastTerminal.failureReason ? `: ${lastTerminal.failureReason}` : ''}${unchecked}`,
      reference,
    };
  }
  if (line.payoutStatus === 'SKIPPED' && !legs.length) return { status: 'SKIPPED', paid, reference };
  return { status: 'PENDING', paid, message: paid > 0 ? 'Partly paid' : null, reference };
}

function time(l: LegLike): number {
  return (l.completedAt ?? l.updatedAt ?? l.createdAt ?? new Date(0)).getTime();
}

/** Batch payoutStatus derived from its lines. */
export function deriveBatchStatus(
  lines: Array<{ payoutStatus: BatchItemPayoutStatus; paidAmount: Num }>,
): 'PENDING' | 'PROCESSING' | 'PARTIAL' | 'SUCCESS' | 'CANCELLED' {
  const active = lines.filter((l) => l.payoutStatus !== 'CANCELLED');
  if (!lines.length) return 'PENDING';
  if (!active.length) return 'CANCELLED';
  if (active.some((l) => l.payoutStatus === 'SENDING')) return 'PROCESSING';
  if (active.every((l) => l.payoutStatus === 'SUCCESS')) return 'SUCCESS';
  if (lines.some((l) => toNum(l.paidAmount) > 0)) return 'PARTIAL';
  return 'PENDING';
}

export function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
