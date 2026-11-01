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
