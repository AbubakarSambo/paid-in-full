import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface WhatsAppTemplateParam {
  type: 'text';
  text: string;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly webhookVerifyToken: string;
  private readonly templateLanguage = 'en';

  constructor(private configService: ConfigService) {
    this.phoneNumberId = this.configService.get<string>('whatsapp.phoneNumberId') || '';
    this.accessToken = this.configService.get<string>('whatsapp.accessToken') || '';
    this.apiVersion = this.configService.get<string>('whatsapp.apiVersion') || 'v21.0';
    this.webhookVerifyToken = this.configService.get<string>('whatsapp.webhookVerifyToken') || '';
  }

  private get isMockMode(): boolean {
    return !this.accessToken || !this.phoneNumberId;
  }

  // WhatsApp requires E.164 digits with no leading '+' or '0'. Numbers saved in local
  // Nigerian format (e.g. "08130000101") are converted to "234..." form.
  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length === 11) return `234${digits.slice(1)}`;
    return digits;
  }

  private async makeRequest<T>(endpoint: string, body: unknown): Promise<T> {
    const url = `https://graph.facebook.com/${this.apiVersion}${endpoint}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new BadRequestException(data?.error?.message || 'WhatsApp API error');
      }
      return data as T;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error('WhatsApp API error', error as Error);
      throw new InternalServerErrorException('Failed to communicate with WhatsApp API');
    }
  }

  async sendTemplateMessage(
    toPhone: string,
    templateName: string,
    params: string[] = [],
  ): Promise<{ providerMessageId: string | null }> {
    const to = this.normalizePhone(toPhone);

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: this.templateLanguage },
        components: params.length
          ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
          : [],
      },
    };

    if (this.isMockMode) {
      this.logger.warn(`[MOCK WHATSAPP] Would send "${templateName}" to ${to} with params: ${JSON.stringify(params)}`);
      return { providerMessageId: null };
    }

    const data = await this.makeRequest<{ messages?: { id: string }[] }>(`/${this.phoneNumberId}/messages`, payload);
    return { providerMessageId: data.messages?.[0]?.id || null };
  }

  isValidVerifyToken(token: string | undefined): boolean {
    return !!this.webhookVerifyToken && token === this.webhookVerifyToken;
  }

  async handleWebhookEvent(payload: any): Promise<void> {
    const entries = payload?.entry || [];
    for (const entry of entries) {
      for (const change of entry?.changes || []) {
        const value = change?.value;
        if (!value) continue;

        for (const status of value.statuses || []) {
          this.logger.log(`[WHATSAPP STATUS] ${status?.id} -> ${status?.status}`);
        }
        for (const message of value.messages || []) {
          this.logger.log(`[WHATSAPP INBOUND] from ${message?.from}: ${JSON.stringify(message)}`);
        }
      }
    }
  }
}
