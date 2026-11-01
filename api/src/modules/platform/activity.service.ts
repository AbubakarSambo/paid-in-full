import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AUDIT_ACTION_EVENT } from '../notifications/notification-events';

const ACTION_TITLES: Record<string, string> = {
  'queue.item_added': 'Queue item added',
  'queue.item_updated': 'Queue item edited',
  'queue.item_amount_changed': 'Queue amount changed',
  'queue.item_deleted': 'Queue item deleted',
  'queue.item_split': 'Queue item split',
  'queue.item_rejected': 'Queue item rejected',
  'queue.item_restored': 'Queue item restored',
  'queue.csv_uploaded': 'CSV uploaded to queue',
  'queue.comment_added': 'Comment added',
  'batch.approved': 'Batch approved',
  'batch.disburse_initiated': 'Disbursement started',
  'batch.reconciled': 'Batch reconciled',
  'batch.cancelled': 'Batch cancelled',
  'batch.deleted': 'Batch deleted',
  'batch.line_returned': 'Line returned to queue',
  'batch.line_cancelled': 'Line cancelled',
  'batch.line_split': 'Line split',
  'batch.line_reclassified': 'Line reclassified',
  'batch.manual_expense_logged': 'Manual expense logged',
  'budget.warning_cancelled': 'Budget warning — cancelled',
  'budget.warning_overridden': 'Budget warning — overridden',
  'budget.updated': 'Budget updated',
  'vendor.created': 'Vendor added',
  'vendor.updated': 'Vendor updated',
  'vendor.deleted': 'Vendor deleted',
  'category.created': 'Category added',
  'category.updated': 'Category updated',
  'category.deleted': 'Category deleted',
  'config.updated': 'Settings updated',
  'role.change': 'Role changed',
  'user.invited': 'User invited',
  'user.removed': 'User removed',
  'pin.set': 'Disbursement PIN updated',
  'requisition.submitted': 'Requisition submitted',
  'requisition.cleared': 'Requisition cleared',
  'requisition.returned': 'Requisition returned',
  'requisition.rejected': 'Requisition rejected',
  'requisition.queued': 'Requisition pushed to queue',
  'wallet.topup_received': 'Wallet top-up received',
  'wallet.topups_reconciled': 'Top-ups reconciled',
  'invoice.issued': 'Invoice issued',
  'invoice.payment_recorded': 'Invoice payment recorded',
  'invoice.voided': 'Invoice voided',
};

export function naira(n: unknown): string | null {
  const v = typeof n === 'string' ? Number(n) : typeof n === 'number' ? n : NaN;
  if (!Number.isFinite(v)) return null;
  return `₦${Math.round(v).toLocaleString('en-NG')}`;
}

export function timeAgo(date: Date, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function humanize(action: string) {
  const [, verb = action] = action.split('.');
  const t = `${action.split('.')[0]} ${verb.replace(/_/g, ' ')}`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "Vendor · ₦X", "{batch_ref} · N item(s)" style one-liners (spec §10). */
export function summarize(action: string, target: string | null, metadata: unknown): string {
  const m = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, any>;
  const amount = naira(m.amount ?? m.total ?? m.netAmount ?? m.net ?? m.gross);
  const count = m.itemCount ?? m.count ?? m.items ?? (Array.isArray(m.itemIds) ? m.itemIds.length : undefined) ?? (Array.isArray(m.queueItemIds) ? m.queueItemIds.length : undefined);
  const subject = m.vendorName ?? m.vendor ?? m.batchRef ?? target ?? '';
  const parts: string[] = [];
  if (subject) parts.push(String(subject));
  if (action.startsWith('batch.') && typeof count === 'number') parts.push(`${count} item${count === 1 ? '' : 's'}`);
  if (action === 'queue.csv_uploaded' && typeof count === 'number') parts.push(`${count} row${count === 1 ? '' : 's'}`);
  if (amount) parts.push(amount);
  if (action === 'role.change') {
    if (m.biller) parts.push(`Biller ${m.biller}`);
    else if (m.from && m.to) parts.push(`${String(m.from).toLowerCase()} → ${String(m.to).toLowerCase()}`);
  }
  return parts.join(' · ');
}

@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Settings → Audit log: last 100 entries with actor names. */
  async auditLog(workspaceId: string, limit = 100) {
    const rows = await this.audit.listForWorkspace(workspaceId, Math.min(limit, 100));
    const names = await this.actorNames(rows.map((r) => r.userId));
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      action: r.action,
      actionLabel: ACTION_TITLES[r.action] ?? humanize(r.action),
      target: r.target,
      actorEmail: r.actorEmail,
      actorName: (r.userId && names.get(r.userId)) || r.actorEmail || 'System',
      metadata: r.metadata,
    }));
  }

  /** Header bell "Recent Activity" feed, honouring the viewer's IN_APP prefs. */
  async feed(workspaceId: string, userId: string, limit = 30) {
    const disabled = await this.notifications.disabledInAppEvents(workspaceId, userId);
    const rows = await this.prisma.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100) * 2,
    });
    const visible = rows.filter((r) => {
      const ev = AUDIT_ACTION_EVENT[r.action];
      return !ev || !disabled.has(ev);
    }).slice(0, Math.min(Math.max(limit, 1), 100));
    const names = await this.actorNames(visible.map((r) => r.userId));
    const now = Date.now();
    return visible.map((r) => ({
      id: r.id,
      action: r.action,
      title: ACTION_TITLES[r.action] ?? humanize(r.action),
      summary: summarize(r.action, r.target, r.metadata),
      actorName: (r.userId && names.get(r.userId)) || r.actorEmail || 'System',
      isMine: r.userId === userId,
      createdAt: r.createdAt,
      timeAgo: timeAgo(r.createdAt, now),
      entityType: r.entityType,
      entityId: r.entityId,
    }));
  }

  private async actorNames(ids: Array<string | null>) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const users = unique.length
      ? await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true, firstName: true, lastName: true, email: true } })
      : [];
    return new Map(users.map((u) => [u.id, u.displayName || `${u.firstName} ${u.lastName}`.trim() || u.email]));
  }
}
