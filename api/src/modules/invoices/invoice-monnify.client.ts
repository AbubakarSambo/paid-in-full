import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface MonnifyConfig {
  baseUrl: string;
  apiKey?: string;
  secretKey?: string;
  contractCode?: string;
  mockMode: boolean;
  relayUrl?: string;
  relaySharedSecret?: string;
}

export type MonnifyCallStatus = 'SUCCESS' | 'PENDING' | 'FAILED';

/**
 * Self-contained Monnify client for the invoicing / client-mandate rails (per-invoice reserved
 * accounts, hosted card checkout + card-token charges, direct-debit mandates, sweep transfers).
 * Kept separate from MonnifyService (owned by the wallet/batches work) the same way
 * BillingService does it, so neither side has to change the other's public surface.
 *
 * Mock mode (MONNIFY_MOCK_MODE=true) never touches the network: every call returns a plausible
 * synchronous result and callers simulate the webhook themselves.
 *
 * UNVERIFIED against a live contract from here: the reserved-account and init-transaction
 * endpoints follow Monnify's public docs; the card-token charge
 * (/api/v1/merchant/cards/charge-card-token), direct-debit mandate
 * (/api/v1/direct-debit/mandate/create, /debit, /cancel-mandate) and response field names are
 * best-effort and need checking against a sandbox before going live.
 */
@Injectable()
export class InvoiceMonnifyClient {
  private readonly logger = new Logger(InvoiceMonnifyClient.name);
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly configService: ConfigService) {}

  private get cfg(): MonnifyConfig {
    return (this.configService.get('monnify') as MonnifyConfig) ?? { baseUrl: 'https://sandbox.monnify.com', mockMode: true };
  }

  get isMock(): boolean {
    return this.cfg.mockMode === true;
  }

  get contractCode(): string | undefined {
    return this.cfg.contractCode;
  }

  private async raw<T>(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const cfg = this.cfg;
    let res: Response;
    if (cfg.relayUrl) {
      res = await fetch(`${cfg.relayUrl.replace(/\/$/, '')}/forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-relay-secret': cfg.relaySharedSecret ?? '' },
        body: JSON.stringify({ method, path, headers, body, baseUrl: cfg.baseUrl }),
      });
    } else {
      res = await fetch(`${cfg.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}),
      });
    }
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || data?.requestSuccessful === false) {
      this.logger.error(`Monnify ${method} ${path} failed: status=${res.status} body=${JSON.stringify(data)}`);
      throw new BadRequestException(data?.responseMessage || data?.message || `Monnify error (${res.status})`);
    }
    return data as T;
  }

  private async authed<T>(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<T> {
    const cfg = this.cfg;
    if (!this.token || this.token.expiresAt < Date.now()) {
      if (!cfg.apiKey || !cfg.secretKey) throw new BadRequestException('Monnify API credentials are not configured');
      const basic = Buffer.from(`${cfg.apiKey}:${cfg.secretKey}`).toString('base64');
      const login = await this.raw<{ responseBody: { accessToken: string; expiresIn: number } }>(
        '/api/v1/auth/login',
        'POST',
        undefined,
        { Authorization: `Basic ${basic}` },
      );
      this.token = {
        value: login.responseBody.accessToken,
        expiresAt: Date.now() + (Number(login.responseBody.expiresIn ?? 3300) - 60) * 1000,
      };
    }
    return this.raw<T>(path, method, body, { Authorization: `Bearer ${this.token.value}` });
  }

  private requireContract(): string {
    if (!this.cfg.contractCode) throw new BadRequestException('Monnify contract code is not configured');
    return this.cfg.contractCode;
  }

  /** Dedicated NUBAN for one invoice (Monnify Reserved Accounts). */
  async createReservedAccount(p: {
    accountReference: string;
    accountName: string;
    customerEmail: string;
    customerName: string;
  }): Promise<{ accountReference: string; accountNumber: string; accountName: string; bankName: string; bankCode: string }> {
    if (this.isMock) {
      const digits = (Date.now().toString() + Math.floor(Math.random() * 1000).toString().padStart(3, '0')).slice(-8);
      return {
        accountReference: p.accountReference,
        accountNumber: `70${digits}`,
        accountName: p.accountName.slice(0, 60),
        bankName: 'Moniepoint MFB (mock)',
        bankCode: '50515',
      };
    }
    const res = await this.authed<{
      responseBody: {
        accountReference: string;
        accountName: string;
        accounts: { bankName: string; bankCode: string; accountNumber: string; accountName?: string }[];
      };
    }>('/api/v2/bank-transfer/reserved-accounts', 'POST', {
      accountReference: p.accountReference,
      accountName: p.accountName.slice(0, 60),
      currencyCode: 'NGN',
      contractCode: this.requireContract(),
      customerEmail: p.customerEmail,
      customerName: p.customerName,
      getAllAvailableBanks: false,
      preferredBanks: ['50515'],
    });
    const a = res.responseBody.accounts[0];
    return {
      accountReference: res.responseBody.accountReference,
      accountNumber: a.accountNumber,
      accountName: a.accountName ?? res.responseBody.accountName,
      bankName: a.bankName,
      bankCode: a.bankCode,
    };
  }

  /** Hosted checkout (init-transaction). Used for the ₦50 card-verification charge on /m/:token. */
  async initCheckout(p: {
    amount: number;
    reference: string;
    customerName: string;
    customerEmail: string;
    description: string;
    redirectUrl?: string;
    paymentMethods?: string[];
    metaData?: Record<string, string>;
  }): Promise<{ reference: string; checkoutUrl: string }> {
    if (this.isMock) {
      return { reference: p.reference, checkoutUrl: `https://sandbox.monnify.com/mock-checkout/${p.reference}` };
    }
    const res = await this.authed<{ responseBody: { transactionReference: string; checkoutUrl: string } }>(
      '/api/v1/merchant/transactions/init-transaction',
      'POST',
      {
        amount: p.amount,
        customerName: p.customerName,
        customerEmail: p.customerEmail,
        paymentReference: p.reference,
        paymentDescription: p.description,
        currencyCode: 'NGN',
        contractCode: this.requireContract(),
        redirectUrl: p.redirectUrl,
        paymentMethods: p.paymentMethods ?? ['CARD'],
        metaData: p.metaData,
      },
    );
    return { reference: p.reference, checkoutUrl: res.responseBody.checkoutUrl };
  }

  /** Recurring charge against a card token captured during the verification checkout. */
  async chargeCardToken(p: {
    cardToken: string;
    amount: number;
    reference: string;
    customerEmail: string;
    customerName: string;
    description: string;
  }): Promise<{ status: MonnifyCallStatus; message?: string }> {
    if (this.isMock) return { status: 'SUCCESS' };
    const res = await this.authed<{ responseBody: { status?: string; paymentStatus?: string; responseMessage?: string } }>(
      '/api/v1/merchant/cards/charge-card-token',
      'POST',
      {
        cardToken: p.cardToken,
        amount: p.amount,
        customerEmail: p.customerEmail,
        customerName: p.customerName,
        paymentReference: p.reference,
        paymentDescription: p.description,
        currencyCode: 'NGN',
        contractCode: this.requireContract(),
        apiKey: this.cfg.apiKey,
      },
    );
    return { status: this.normaliseStatus(res.responseBody?.paymentStatus ?? res.responseBody?.status) };
  }

  async createDirectDebitMandate(p: {
    reference: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    customerAddress: string;
    accountNumber: string;
    bankCode: string;
    amount: number;
    description: string;
    startDate: Date;
    endDate?: Date;
  }): Promise<{ mandateId: string; status: MonnifyCallStatus; authorizationLink?: string }> {
    if (this.isMock) return { mandateId: `MOCK-MDT-${p.reference}`, status: 'SUCCESS' };
    const res = await this.authed<{
      responseBody: { mandateCode?: string; mandateReference?: string; mandateStatus?: string; mandateAuthorizationLink?: string };
    }>('/api/v1/direct-debit/mandate/create', 'POST', {
      contractCode: this.requireContract(),
      mandateReference: p.reference,
      autoRenew: true,
      customerName: p.customerName,
      customerPhoneNumber: p.customerPhone,
      customerEmailAddress: p.customerEmail,
      customerAddress: p.customerAddress,
      customerAccountNumber: p.accountNumber,
      customerAccountBankCode: p.bankCode,
      mandateDescription: p.description,
      mandateStartDate: p.startDate.toISOString(),
      mandateEndDate: (p.endDate ?? new Date(p.startDate.getTime() + 5 * 365 * 86_400_000)).toISOString(),
      debitAmount: p.amount,
    });
    const b = res.responseBody ?? {};
    const status = (b.mandateStatus ?? '').toUpperCase();
    return {
      mandateId: b.mandateCode ?? b.mandateReference ?? p.reference,
      status: status === 'ACTIVE' ? 'SUCCESS' : status === 'FAILED' || status === 'CANCELLED' ? 'FAILED' : 'PENDING',
      authorizationLink: b.mandateAuthorizationLink,
    };
  }

  async debitMandate(p: {
    mandateId: string;
    amount: number;
    reference: string;
    narration: string;
    customerEmail: string;
  }): Promise<{ status: MonnifyCallStatus; message?: string }> {
    if (this.isMock) return { status: 'SUCCESS' };
    const res = await this.authed<{ responseBody: { transactionStatus?: string; status?: string } }>(
      '/api/v1/direct-debit/mandate/debit',
      'POST',
      {
        paymentReference: p.reference,
        mandateCode: p.mandateId,
        debitAmount: p.amount,
        narration: p.narration,
        customerEmail: p.customerEmail,
      },
    );
    return { status: this.normaliseStatus(res.responseBody?.transactionStatus ?? res.responseBody?.status) };
  }

  async cancelMandate(mandateId: string): Promise<void> {
    if (this.isMock) return;
    try {
      await this.authed(`/api/v1/direct-debit/mandate/cancel-mandate/${encodeURIComponent(mandateId)}`, 'DELETE');
    } catch (err) {
      this.logger.warn(`Monnify cancel mandate ${mandateId} failed: ${(err as Error).message}`);
    }
  }

  /** Single transfer (disbursement), used to sweep invoice collections out to the configured bank. */
  async transfer(p: {
    amount: number;
    reference: string;
    narration: string;
    bankCode: string;
    accountNumber: string;
    sourceAccountNumber?: string | null;
  }): Promise<{ status: MonnifyCallStatus }> {
    if (this.isMock) return { status: 'SUCCESS' };
    const res = await this.authed<{ responseBody: { status?: string } }>('/api/v2/disbursements/single', 'POST', {
      amount: p.amount,
      reference: p.reference,
      narration: p.narration.slice(0, 100),
      destinationBankCode: p.bankCode,
      destinationAccountNumber: p.accountNumber,
      currency: 'NGN',
      sourceAccountNumber: p.sourceAccountNumber ?? undefined,
    });
    return { status: this.normaliseStatus(res.responseBody?.status) };
  }

  private normaliseStatus(s: string | undefined): MonnifyCallStatus {
    const v = (s ?? '').toUpperCase();
    if (['SUCCESS', 'PAID', 'SUCCESSFUL', 'COMPLETED', 'OVERPAID'].includes(v)) return 'SUCCESS';
    if (['FAILED', 'DECLINED', 'REVERSED', 'CANCELLED', 'EXPIRED'].includes(v)) return 'FAILED';
    return 'PENDING';
  }
}
