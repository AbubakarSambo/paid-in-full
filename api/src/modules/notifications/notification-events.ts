/** Spec §10 / §5.10 #21 notification events and channels. */
export const NOTIFICATION_EVENTS = ['queue_added', 'batch_pending_approval', 'disbursement_result'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Accepted by notify(); `batch_approved` is the push name for the batch_pending_approval pref. */
export type NotifyEvent = NotificationEvent | 'batch_approved';

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const EVENT_LABELS: Record<NotificationEvent, string> = {
  queue_added: 'New queue item added',
  batch_pending_approval: 'Batch awaiting approval',
  disbursement_result: 'Disbursement result',
};

/** Defaults when a user has never saved a pref. Email alerts are optional (off). */
export const DEFAULT_CHANNEL_ENABLED: Record<NotificationChannel, boolean> = {
  IN_APP: true,
  EMAIL: false,
  PUSH: true,
};

export function prefEvent(event: NotifyEvent): NotificationEvent {
  return event === 'batch_approved' ? 'batch_pending_approval' : event;
}

/** Audit actions that feed the in-app Recent Activity per event (used to honour IN_APP prefs). */
export const AUDIT_ACTION_EVENT: Record<string, NotificationEvent> = {
  'queue.item_added': 'queue_added',
  'queue.csv_uploaded': 'queue_added',
  'batch.approved': 'batch_pending_approval',
  'batch.disburse_initiated': 'disbursement_result',
  'batch.reconciled': 'disbursement_result',
};
