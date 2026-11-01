/**
 * Audit-log action names from spec §4 audit_log (+ a few the spec's modules imply).
 * Use with AuditLogService.record(workspaceId, actor, AUDIT_ACTIONS.X, target, metadata).
 */
export const AUDIT_ACTIONS = {
  // Queue
  QUEUE_ITEM_ADDED: 'queue.item_added',
  QUEUE_ITEM_UPDATED: 'queue.item_updated',
  QUEUE_ITEM_AMOUNT_CHANGED: 'queue.item_amount_changed',
  QUEUE_ITEM_DELETED: 'queue.item_deleted',
  QUEUE_ITEM_SPLIT: 'queue.item_split',
  QUEUE_ITEM_REJECTED: 'queue.item_rejected',
  QUEUE_ITEM_RESTORED: 'queue.item_restored',
  QUEUE_CSV_UPLOADED: 'queue.csv_uploaded',
  QUEUE_COMMENT_ADDED: 'queue.comment_added',
  // Batches
  BATCH_APPROVED: 'batch.approved',
  BATCH_DISBURSE_INITIATED: 'batch.disburse_initiated',
  BATCH_RECONCILED: 'batch.reconciled',
  BATCH_CANCELLED: 'batch.cancelled',
  BATCH_DELETED: 'batch.deleted',
  BATCH_LINE_RETURNED: 'batch.line_returned',
  BATCH_LINE_CANCELLED: 'batch.line_cancelled',
  BATCH_LINE_SPLIT: 'batch.line_split',
  BATCH_LINE_RECLASSIFIED: 'batch.line_reclassified',
  BATCH_MANUAL_EXPENSE_LOGGED: 'batch.manual_expense_logged',
  // Budgets
  BUDGET_WARNING_CANCELLED: 'budget.warning_cancelled',
  BUDGET_WARNING_OVERRIDDEN: 'budget.warning_overridden',
  BUDGET_UPDATED: 'budget.updated',
  // Vendors / settings
  VENDOR_CREATED: 'vendor.created',
  VENDOR_UPDATED: 'vendor.updated',
  VENDOR_DELETED: 'vendor.deleted',
  CATEGORY_CREATED: 'category.created',
  CATEGORY_UPDATED: 'category.updated',
  CATEGORY_DELETED: 'category.deleted',
  CONFIG_UPDATED: 'config.updated',
  // Users / roles
  ROLE_CHANGE: 'role.change',
  USER_INVITED: 'user.invited',
  USER_REMOVED: 'user.removed',
  PIN_SET: 'pin.set',
  // Requisitions
  REQUISITION_SUBMITTED: 'requisition.submitted',
  REQUISITION_CLEARED: 'requisition.cleared',
  REQUISITION_RETURNED: 'requisition.returned',
  REQUISITION_REJECTED: 'requisition.rejected',
  REQUISITION_QUEUED: 'requisition.queued',
  // Wallet
  WALLET_TOPUP_RECEIVED: 'wallet.topup_received',
  WALLET_TOPUPS_RECONCILED: 'wallet.topups_reconciled',
  // Invoicing
  INVOICE_ISSUED: 'invoice.issued',
  INVOICE_PAYMENT_RECORDED: 'invoice.payment_recorded',
  INVOICE_VOIDED: 'invoice.voided',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
