import { Body, Controller, Get, HttpStatus, Logger, Param, Post, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Resend webhook event shape (subset): https://resend.com/docs/dashboard/webhooks/event-types
interface ResendWebhookPayload {
  type?: string; // e.g. 'email.bounced', 'email.complained', 'email.delivered'
  data?: {
    email_id?: string;
    to?: string[];
    subject?: string;
  };
}

@ApiExcludeController()
@Controller('email')
export class EmailController {
  private readonly logger = new Logger(EmailController.name);

  constructor(private prisma: PrismaService) {}

  // Resend expects a fast 2xx regardless of outcome, or it retries aggressively.
  @Public()
  @Post('webhook')
  async webhook(@Body() payload: ResendWebhookPayload) {
    try {
      const type = payload?.type || '';
      const recipients = payload?.data?.to || [];

      if (type === 'email.bounced' || type === 'email.complained') {
        const reason = type === 'email.bounced' ? 'BOUNCE' : 'COMPLAINT';
        for (const email of recipients) {
          await this.prisma.suppressedEmail.upsert({
            where: { email },
            create: { email, reason },
            update: { reason },
          });
          await this.prisma.emailSendLog.create({
            data: { toEmail: email, template: payload?.data?.subject || 'UNKNOWN', status: 'BOUNCED' },
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to process Resend webhook event', error);
    }

    return { received: true };
  }

  // Bypasses the global response envelope (@Res()) so the link renders as a page, not JSON.
  @Public()
  @Get('unsubscribe/:token')
  async unsubscribe(@Param('token') token: string, @Res() res: Response) {
    const record = await this.prisma.emailUnsubscribeToken.findUnique({ where: { token } });

    if (!record) {
      return res.status(HttpStatus.NOT_FOUND).send(this.renderHtmlPage('Invalid or expired unsubscribe link.'));
    }

    await this.prisma.suppressedEmail.upsert({
      where: { email: record.email },
      create: { email: record.email, reason: 'UNSUBSCRIBE' },
      update: { reason: 'UNSUBSCRIBE' },
    });

    return res
      .status(HttpStatus.OK)
      .send(this.renderHtmlPage(`${record.email} has been unsubscribed from Paid in Full emails.`));
  }

  private renderHtmlPage(message: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Paid in Full</title></head>
<body style="font-family: -apple-system, sans-serif; padding: 48px; text-align: center; color: #121c28;">
  <h2>${message}</h2>
</body></html>`;
  }
}
