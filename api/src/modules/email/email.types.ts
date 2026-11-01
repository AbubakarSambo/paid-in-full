// Template names supported by EmailService.send(). Each maps to a case in
// EmailService's renderTemplate() switch, with its own expected `data` shape
// (documented per-case, not enforced at the type level to keep callers simple).
export type EmailTemplateName =
  | 'INVITE'
  | 'MAGIC_LINK'
  | 'PASSWORD_RESET'
  | 'INVOICE_SENT'
  | 'QUEUE_ITEM_ADDED'
  | 'PAYMENT_MADE'
  | 'SUBSCRIPTION_PAYMENT_FAILED'
  | 'SUBSCRIPTION_PAYMENT_RECEIPT'
  | 'SUBSCRIPTION_SUSPENDED'
  | 'EMAIL_VERIFY'
  | 'NOTIFICATION';

export interface InviteEmailData {
  token: string;
  workspaceName: string;
  firstName?: string;
}

export interface EmailVerifyEmailData {
  token: string;
  firstName?: string;
}

/** Generic alert used by NotificationsService.notify() (queue_added, batch_*, disbursement_result, test). */
export interface NotificationEmailData {
  title: string;
  body: string;
  recipientName?: string;
  workspaceName?: string;
  /** Path inside the app (e.g. "/app?tab=queue") or absolute URL. */
  url?: string;
  ctaText?: string;
}

export interface MagicLinkEmailData {
  token: string;
  firstName?: string;
}

export interface PasswordResetEmailData {
  token: string;
  firstName?: string;
}

export interface InvoiceSentEmailData {
  clientName: string;
  invoiceNumber: string;
  workspaceName: string;
  total: string;
  dueDate: string;
  paymentUrl?: string | null;
}

export interface QueueItemAddedEmailData {
  recipientName?: string;
  itemDescription: string;
  amount: string;
  workspaceName: string;
  vendorName?: string;
}

export interface PaymentMadeEmailData {
  recipientName?: string;
  vendorName: string;
  amount: string;
  batchRef: string;
  paidAt: string;
  workspaceName: string;
}

export interface SubscriptionPaymentFailedEmailData {
  firstName?: string;
  planTier: string;
}

export interface SubscriptionPaymentReceiptEmailData {
  firstName?: string;
  planTier: string;
  amount: string;
  nextBillingDate: string;
}

export interface SubscriptionSuspendedEmailData {
  firstName?: string;
  workspaceName: string;
}

export type EmailTemplateData =
  | InviteEmailData
  | MagicLinkEmailData
  | PasswordResetEmailData
  | InvoiceSentEmailData
  | QueueItemAddedEmailData
  | PaymentMadeEmailData
  | SubscriptionPaymentFailedEmailData
  | SubscriptionPaymentReceiptEmailData
  | SubscriptionSuspendedEmailData
  | EmailVerifyEmailData
  | NotificationEmailData;
