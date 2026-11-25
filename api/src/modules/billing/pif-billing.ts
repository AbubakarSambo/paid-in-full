import { SubscriptionStatus, WorkspaceStatus } from '@prisma/client';

/** Spec §5.10 #17: "Paused if not paid within 7 days of due." */
export const PIF_GRACE_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

/** Keeps the legacy subscriptionStatus (read by SubscriptionReadOnlyGuard) in step with the console status. */
export function subscriptionStatusFor(status: WorkspaceStatus): SubscriptionStatus {
  switch (status) {
    case WorkspaceStatus.ACTIVE:
      return SubscriptionStatus.ACTIVE;
    case WorkspaceStatus.LEAD:
    case WorkspaceStatus.TRIAL:
      return SubscriptionStatus.TRIALING;
    case WorkspaceStatus.DEAD:
      return SubscriptionStatus.CANCELLED;
    default: // PAUSED, SUSPENDED → read-only
      return SubscriptionStatus.EXPIRED;
  }
}

export interface PifDueFields {
  status: WorkspaceStatus;
  paidUntil: Date | null;
  nextDueDate: Date | null;
  trialEndDate: Date | null;
  billingDay?: number | null;
}

/**
 * Next due date = explicit nextDueDate, else paidUntil (the paid period ends), else trial end.
 * Overdue once past due and not paid through it; should pause once 7 days past due.
 */
export function pifDueInfo(ws: PifDueFields, now = new Date()) {
  const nextDue = ws.nextDueDate ?? ws.paidUntil ?? ws.trialEndDate ?? null;
  const paidThrough = ws.paidUntil && nextDue ? ws.paidUntil >= nextDue && ws.paidUntil > now : false;
  const overdue = !!nextDue && nextDue < now && !paidThrough;
  const graceEndsAt = nextDue ? new Date(nextDue.getTime() + PIF_GRACE_DAYS * DAY) : null;
  const shouldPause = overdue && !!graceEndsAt && graceEndsAt < now && (ws.status === WorkspaceStatus.ACTIVE || ws.status === WorkspaceStatus.TRIAL);
  return { nextDue, overdue, graceEndsAt, shouldPause, daysOverdue: overdue && nextDue ? Math.floor((now.getTime() - nextDue.getTime()) / DAY) : 0 };
}

export function addPeriod(from: Date, period: '30d' | '90d' | '1y'): Date {
  const d = new Date(from);
  if (period === '1y') d.setFullYear(d.getFullYear() + 1);
  else d.setDate(d.getDate() + (period === '30d' ? 30 : 90));
  return d;
}

export interface PifCoverageInput {
  amount: number;
  /** Plan terms; null when the workspace has no plan row. */
  plan: { monthly: number; setupFee: number; prepayMonths: number; prepayMonthly: number } | null;
  setupFeePaid: boolean;
  /** Used when there is no plan (the workspace's own monthly amount, else the amount itself). */
  fallbackMonthly: number;
}

/**
 * How many months a subscription payment buys, ported from Lovable's billing-collection rules:
 * a payment first covers an unpaid setup fee (when it is large enough), the remainder buys the prepay
 * bundle if it reaches `prepayMonthly * prepayMonths`, otherwise whole months at the plan's monthly price
 * (at least one).
 */
export function pifPaymentCoverage(i: PifCoverageInput) {
  const monthly = i.plan ? i.plan.monthly : i.fallbackMonthly;
  let remaining = i.amount;
  let coversSetup = false;
  if (i.plan && i.plan.setupFee > 0 && !i.setupFeePaid && i.amount >= i.plan.setupFee) {
    coversSetup = true;
    remaining = i.amount - i.plan.setupFee;
  }
  let months = 1;
  if (i.plan && i.plan.prepayMonths > 0 && i.plan.prepayMonthly > 0 && remaining >= i.plan.prepayMonthly * i.plan.prepayMonths) {
    months = i.plan.prepayMonths;
  } else if (monthly > 0) {
    months = Math.max(1, Math.floor(remaining / monthly));
  }
  return { months, coversSetup };
}
