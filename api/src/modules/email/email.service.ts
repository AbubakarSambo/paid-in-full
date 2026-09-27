import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';
import {
  EmailTemplateName,
  InviteEmailData,
  MagicLinkEmailData,
  PasswordResetEmailData,
  InvoiceSentEmailData,
  QueueItemAddedEmailData,
  PaymentMadeEmailData,
  SubscriptionPaymentFailedEmailData,
  SubscriptionPaymentReceiptEmailData,
  SubscriptionSuspendedEmailData,
} from './email.types';

interface EmailHtmlOptions {
  accentColor?: string;
  contextLabel?: string;
  headline: string;
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
  footerNote?: string;
  unsubscribeUrl?: string;
}

export interface SendEmailOptions {
  // Skip re-sending the same template to the same recipient within this many hours.
  // Omitted (default) means no cooldown is applied.
  cooldownHours?: number;
}

// Templates that carry an unsubscribe footer link. Auth-critical/security templates
// (invite, magic link, password reset) deliberately omit it — unsubscribing from those
// would lock a user out of account-recovery flows.
const UNSUBSCRIBABLE_TEMPLATES = new Set<EmailTemplateName>([
  'INVOICE_SENT',
  'QUEUE_ITEM_ADDED',
  'PAYMENT_MADE',
  'SUBSCRIPTION_PAYMENT_FAILED',
  'SUBSCRIPTION_PAYMENT_RECEIPT',
  'SUBSCRIPTION_SUSPENDED',
]);

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend;
  private fromEmail: string;
  private frontendUrl: string;
  private brandWebsiteUrl: string;
  private isMock = false;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    let apiKey = this.configService.get<string>('resend.apiKey');
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY is not set. EmailService will run in MOCK mode (logging to console).');
      this.isMock = true;
      apiKey = 're_mock_key';
    }
    this.resend = new Resend(apiKey);
    this.fromEmail =
      this.configService.get<string>('resend.fromEmail') || 'Paid in Full <noreply@paidinfull.app>';

    let frontend = this.configService.get<string>('resend.frontendUrl') || 'http://localhost:5173';
    frontend = frontend.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(frontend)) frontend = `https://${frontend}`;
    this.frontendUrl = frontend;

    let brand = this.configService.get<string>('resend.brandWebsiteUrl') || 'https://www.paidinfull.app';
    brand = brand.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(brand)) brand = `https://${brand}`;
    this.brandWebsiteUrl = brand;
  }

  /**
   * Sends `template` to `to`, skipping delivery (and logging why) when the recipient is on
   * the suppression list or, if `cooldownHours` is given, was already sent this exact
   * template within that window.
   */
  async send(to: string, template: EmailTemplateName, data: any, options: SendEmailOptions = {}): Promise<void> {
    const suppressed = await this.prisma.suppressedEmail.findUnique({ where: { email: to } });
    if (suppressed) {
      this.logger.warn(`Skipping ${template} to ${to}: recipient is suppressed (${suppressed.reason})`);
      await this.prisma.emailSendLog.create({
        data: { toEmail: to, template, status: 'SUPPRESSED' },
      });
      return;
    }

    if (options.cooldownHours && options.cooldownHours > 0) {
      const state = await this.prisma.emailSendState.findUnique({
        where: { toEmail_template: { toEmail: to, template } },
      });
      if (state) {
        const elapsedMs = Date.now() - state.lastSentAt.getTime();
        if (elapsedMs < options.cooldownHours * 60 * 60 * 1000) {
          this.logger.log(`Skipping ${template} to ${to}: within ${options.cooldownHours}h cooldown`);
          await this.prisma.emailSendLog.create({
            data: { toEmail: to, template, status: 'SKIPPED_COOLDOWN' },
          });
          return;
        }
      }
    }

    let unsubscribeUrl: string | undefined;
    if (UNSUBSCRIBABLE_TEMPLATES.has(template)) {
      unsubscribeUrl = await this.buildUnsubscribeUrl(to);
    }

    const { subject, html } = this.renderTemplate(template, data, unsubscribeUrl);

    try {
      await this.dispatch({ to, subject, html });
      await this.prisma.emailSendLog.create({ data: { toEmail: to, template, status: 'SENT' } });
      await this.prisma.emailSendState.upsert({
        where: { toEmail_template: { toEmail: to, template } },
        create: { toEmail: to, template, lastSentAt: new Date() },
        update: { lastSentAt: new Date() },
      });
    } catch (error) {
      await this.prisma.emailSendLog.create({ data: { toEmail: to, template, status: 'FAILED' } });
      throw error;
    }
  }

  private async buildUnsubscribeUrl(email: string): Promise<string> {
    const token = await this.prisma.emailUnsubscribeToken.create({
      data: { email, token: randomBytes(24).toString('hex') },
    });
    return `${this.frontendUrl.replace('5173', '3000')}/api/v1/email/unsubscribe/${token.token}`;
  }

  private async dispatch(options: { to: string; subject: string; html: string }): Promise<void> {
    if (this.isMock) {
      this.logger.log(`[MOCK EMAIL] To: ${options.to} | Subject: ${options.subject}`);
      const linkRegex = /href="([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(options.html)) !== null) {
        this.logger.log(`[MOCK EMAIL] Link: ${match[1]}`);
      }
      return;
    }

    const { data, error } = await this.resend.emails.send({
      from: this.fromEmail,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    if (error) {
      this.logger.error(`Failed to send email to ${options.to}: ${error.name} - ${error.message}`);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    this.logger.log(`Email sent to ${options.to} (id: ${data?.id})`);
  }

  private buildEmailHtml(options: EmailHtmlOptions): string {
    const accentColor = options.accentColor || '#0037b0';

    const ctaSection =
      options.ctaText && options.ctaUrl
        ? `
        <div style="margin: 32px 0; text-align: left;">
          <table border="0" cellpadding="0" cellspacing="0" style="border-collapse: separate; width: auto;">
            <tr>
              <td align="center" valign="middle" style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; border-radius: 12px; background-color: ${accentColor};" bgcolor="${accentColor}">
                <a href="${options.ctaUrl}" target="_blank" style="border: 12px solid ${accentColor}; border-left: 24px solid ${accentColor}; border-right: 24px solid ${accentColor}; display: inline-block; color: #ffffff !important; background-color: ${accentColor}; text-decoration: none; font-weight: 600; border-radius: 12px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                  ${options.ctaText}
                </a>
              </td>
            </tr>
          </table>
        </div>
      `
        : '';

    const footerNoteSection = options.footerNote
      ? `<p style="margin-top: 16px; margin-bottom: 0; font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.5; color: #64748b; font-style: italic;">${options.footerNote}</p>`
      : '';

    const contextLabelSection = options.contextLabel
      ? `<div style="font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 700; color: ${accentColor}; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 8px;">${options.contextLabel}</div>`
      : '';

    const unsubscribeSection = options.unsubscribeUrl
      ? `<p style="margin: 8px 0 0 0; font-size: 11px;"><a href="${options.unsubscribeUrl}" style="color: #94a3b8;">Unsubscribe from these emails</a></p>`
      : '';

    const currentYear = new Date().getFullYear();

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${options.headline}</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    table { border-collapse: collapse !important; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f8f9ff; }
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    .receipt-label { color: #64748b; }
    .receipt-value { color: #121c28; font-weight: 700; }
    @media screen and (max-width: 600px) {
      .email-container { width: 100% !important; padding: 16px !important; }
      .email-card { border-radius: 16px !important; }
      .email-card-content { padding: 24px !important; }
    }
    @media (prefers-color-scheme: dark) {
      body { background-color: #0b131f !important; }
      .email-card { background-color: #121c28 !important; border-color: #1e293b !important; }
      .text-title { color: #ffffff !important; }
      .text-body { color: #94a3b8 !important; }
      .receipt-box { background-color: #1e293b !important; border-color: #334155 !important; }
      .footer-text { color: #64748b !important; }
      .receipt-label { color: #94a3b8 !important; }
      .receipt-value { color: #ffffff !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f8f9ff; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8f9ff;">
    <tr>
      <td align="center" style="padding: 40px 20px;" class="email-container">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; background-color: #ffffff; border: 1px solid #eef4ff; border-radius: 20px; box-shadow: 0px 12px 32px rgba(0, 55, 176, 0.04); overflow: hidden;" class="email-card">
          <tr>
            <td height="6" style="background-color: ${accentColor}; font-size: 0px; line-height: 0px;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding: 40px;" class="email-card-content">
              <div style="margin-bottom: 32px; text-align: left; font-family: 'Inter', sans-serif; font-size: 22px; font-weight: 700; color: ${accentColor}; letter-spacing: -0.02em;">
                Paid in Full
              </div>
              ${contextLabelSection}
              <h1 class="text-title" style="margin-top: 0; margin-bottom: 16px; font-family: 'Inter', sans-serif; font-size: 24px; font-weight: 700; line-height: 1.3; color: #121c28; letter-spacing: -0.02em;">
                ${options.headline}
              </h1>
              <div class="text-body" style="font-family: 'Inter', sans-serif; font-size: 15px; line-height: 1.6; color: #434655; margin-bottom: 0;">
                ${options.bodyHtml}
              </div>
              ${ctaSection}
              ${footerNoteSection}
            </td>
          </tr>
        </table>
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; margin-top: 24px; text-align: center;">
          <tr>
            <td class="footer-text" style="font-family: 'Inter', sans-serif; font-size: 12px; line-height: 1.5; color: #94a3b8; padding: 0 20px;">
              <p style="margin: 0 0 4px 0;">&copy; ${currentYear} Paid in Full &middot; ${this.brandWebsiteUrl.replace(/^https?:\/\/(www\.)?/, '')}</p>
              <p style="margin: 0; font-size: 11px;">You are receiving this email because of your Paid in Full account activity.</p>
              ${unsubscribeSection}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private renderTemplate(
    template: EmailTemplateName,
    data: any,
    unsubscribeUrl?: string,
  ): { subject: string; html: string } {
    switch (template) {
      case 'INVITE': {
        const d = data as InviteEmailData;
        const setPasswordUrl = `${this.frontendUrl}/set-password?token=${d.token}`;
        return {
          subject: `You've been invited to join ${d.workspaceName} on Paid in Full`,
          html: this.buildEmailHtml({
            contextLabel: 'Workspace Invitation',
            headline: `Join ${d.workspaceName} on Paid in Full`,
            bodyHtml: `
              <p>Hi ${d.firstName || 'there'},</p>
              <p>You have been invited to join <strong>${d.workspaceName}</strong> on Paid in Full — batch vendor-payment disbursement for Nigerian SMEs.</p>
              <p>Click the button below to set your password and get started:</p>
            `,
            ctaText: 'Set Password & Join',
            ctaUrl: setPasswordUrl,
            footerNote: 'This invitation link is valid for 7 days. If you did not expect this invitation, you can safely ignore this email.',
          }),
        };
      }

      case 'MAGIC_LINK': {
        const d = data as MagicLinkEmailData;
        const url = `${this.frontendUrl}/magic-link?token=${d.token}`;
        return {
          subject: 'Your Paid in Full sign-in link',
          html: this.buildEmailHtml({
            contextLabel: 'Security',
            headline: 'Sign in to Paid in Full',
            bodyHtml: `
              <p>Hi ${d.firstName || 'there'},</p>
              <p>Click the button below to sign in instantly. No password is required.</p>
            `,
            ctaText: 'Sign In',
            ctaUrl: url,
            footerNote: 'This link is valid for 24 hours. If you did not request this, you can safely ignore this email.',
          }),
        };
      }

      case 'PASSWORD_RESET': {
        const d = data as PasswordResetEmailData;
        const url = `${this.frontendUrl}/reset-password?token=${d.token}`;
        return {
          subject: 'Reset your Paid in Full password',
          html: this.buildEmailHtml({
            contextLabel: 'Security',
            headline: 'Reset your password',
            bodyHtml: `
              <p>Hi ${d.firstName || 'there'},</p>
              <p>We received a request to reset the password for your Paid in Full account. Click the button below to choose a new one:</p>
            `,
            ctaText: 'Reset Password',
            ctaUrl: url,
            footerNote: "This link is valid for 1 hour. If you didn't request a password reset, you can safely ignore this email.",
          }),
        };
      }

      case 'INVOICE_SENT': {
        const d = data as InvoiceSentEmailData;
        return {
          subject: `New Invoice ${d.invoiceNumber} from ${d.workspaceName}`,
          html: this.buildEmailHtml({
            contextLabel: 'Invoice Delivery',
            headline: `New Invoice ${d.invoiceNumber} from ${d.workspaceName}`,
            bodyHtml: `
              <p>Hi ${d.clientName},</p>
              <p><strong>${d.workspaceName}</strong> has sent you a new invoice for <strong>${d.total}</strong>, due <strong>${d.dueDate}</strong>.</p>
            `,
            ctaText: d.paymentUrl ? 'View / Pay Invoice' : undefined,
            ctaUrl: d.paymentUrl || undefined,
            unsubscribeUrl,
          }),
        };
      }

      case 'QUEUE_ITEM_ADDED': {
        const d = data as QueueItemAddedEmailData;
        return {
          subject: `New item added to the payment queue: ${d.itemDescription}`,
          html: this.buildEmailHtml({
            contextLabel: 'Payment Queue',
            headline: 'A new item was added to the payment queue',
            bodyHtml: `
              <p>Hi ${d.recipientName || 'there'},</p>
              <p>A new item was added to <strong>${d.workspaceName}</strong>'s payment queue${d.vendorName ? ` for <strong>${d.vendorName}</strong>` : ''}:</p>
              <div class="receipt-box" style="margin: 24px 0; padding: 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.6;">
                  <tr><td class="receipt-label">Description</td><td align="right" class="receipt-value">${d.itemDescription}</td></tr>
                  <tr><td class="receipt-label">Amount</td><td align="right" class="receipt-value">${d.amount}</td></tr>
                </table>
              </div>
              <p>Review it in the requisitions queue.</p>
            `,
            unsubscribeUrl,
          }),
        };
      }

      case 'PAYMENT_MADE': {
        const d = data as PaymentMadeEmailData;
        return {
          subject: `Payment made to ${d.vendorName}`,
          html: this.buildEmailHtml({
            accentColor: '#006c49',
            contextLabel: 'Payment Confirmation',
            headline: `Payment sent to ${d.vendorName}`,
            bodyHtml: `
              <p>Hi ${d.recipientName || 'there'},</p>
              <p><strong>${d.workspaceName}</strong> has disbursed a payment to <strong>${d.vendorName}</strong>:</p>
              <div class="receipt-box" style="margin: 24px 0; padding: 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.6;">
                  <tr><td class="receipt-label">Amount</td><td align="right" class="receipt-value" style="color: #006c49 !important;">${d.amount}</td></tr>
                  <tr><td class="receipt-label">Batch Ref</td><td align="right" class="receipt-value">${d.batchRef}</td></tr>
                  <tr><td class="receipt-label">Paid At</td><td align="right" class="receipt-value">${d.paidAt}</td></tr>
                </table>
              </div>
            `,
            unsubscribeUrl,
          }),
        };
      }

      case 'SUBSCRIPTION_PAYMENT_FAILED': {
        const d = data as SubscriptionPaymentFailedEmailData;
        return {
          subject: 'Your Paid in Full subscription payment failed',
          html: this.buildEmailHtml({
            accentColor: '#ba1a1a',
            contextLabel: 'Billing Action Required',
            headline: 'Subscription payment failed',
            bodyHtml: `
              <p>Hi ${d.firstName || 'there'},</p>
              <p>We were unable to process payment for your <strong>${d.planTier}</strong> subscription. Please update your payment method to avoid service interruption.</p>
            `,
            ctaText: 'Update Payment Method',
            ctaUrl: `${this.frontendUrl}/settings/billing`,
            unsubscribeUrl,
          }),
        };
      }

      case 'SUBSCRIPTION_PAYMENT_RECEIPT': {
        const d = data as SubscriptionPaymentReceiptEmailData;
        return {
          subject: 'Payment receipt - Paid in Full',
          html: this.buildEmailHtml({
            accentColor: '#006c49',
            contextLabel: 'Payment Receipt',
            headline: 'Subscription payment received',
            bodyHtml: `
              <p>Hi ${d.firstName || 'there'},</p>
              <p>Thank you! We've received payment for your <strong>${d.planTier}</strong> subscription.</p>
              <div class="receipt-box" style="margin: 24px 0; padding: 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.6;">
                  <tr><td class="receipt-label">Amount Paid</td><td align="right" class="receipt-value">${d.amount}</td></tr>
                  <tr><td class="receipt-label">Next Billing Date</td><td align="right" class="receipt-value">${d.nextBillingDate}</td></tr>
                </table>
              </div>
            `,
            unsubscribeUrl,
          }),
        };
      }

      case 'SUBSCRIPTION_SUSPENDED': {
        const d = data as SubscriptionSuspendedEmailData;
        return {
          subject: `${d.workspaceName}'s subscription has been suspended`,
          html: this.buildEmailHtml({
            accentColor: '#ba1a1a',
            contextLabel: 'Subscription Suspended',
            headline: 'Your subscription has been suspended',
            bodyHtml: `
              <p>Hi ${d.firstName || 'there'},</p>
              <p><strong>${d.workspaceName}</strong>'s subscription has been suspended due to a failed renewal. Your data is safe, but access is locked until this is resolved.</p>
            `,
            ctaText: 'Reactivate Subscription',
            ctaUrl: `${this.frontendUrl}/settings/billing`,
            unsubscribeUrl,
          }),
        };
      }

      default:
        throw new Error(`Unknown email template: ${template}`);
    }
  }
}
