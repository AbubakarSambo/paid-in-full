import { BadRequestException, Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import {
  CreateReservedAccountResult,
  InitializeTransactionParams,
  InitializeTransactionResult,
  InitiateSingleTransferParams,
  InitiateSingleTransferResult,
  MonnifyBank,
  VerifyBankAccountResult,
} from './dto';

// A representative subset of Nigerian banks Monnify's disbursement/verify-account endpoints
// support, keyed by their Monnify bank code. Used verbatim in mock mode; in live mode this is
// only a fallback if GET /api/v1/banks itself fails, since the real list is fetched live.
const FALLBACK_BANKS: MonnifyBank[] = [
  { name: 'Access Bank', code: '044' },
  { name: 'Guaranty Trust Bank', code: '058' },
  { name: 'Zenith Bank', code: '057' },
  { name: 'United Bank for Africa', code: '033' },
  { name: 'First Bank of Nigeria', code: '011' },
  { name: 'Fidelity Bank', code: '070' },
  { name: 'Union Bank of Nigeria', code: '032' },
  { name: 'Sterling Bank', code: '232' },
  { name: 'Wema Bank', code: '035' },
  { name: 'Ecobank Nigeria', code: '050' },
  { name: 'Polaris Bank', code: '076' },
  { name: 'First City Monument Bank', code: '214' },
  { name: 'Stanbic IBTC Bank', code: '221' },
  { name: 'Unity Bank', code: '215' },
  { name: 'Keystone Bank', code: '082' },
  { name: 'Providus Bank', code: '101' },
  { name: 'Moniepoint MFB', code: '50515' },
  { name: 'OPay', code: '999992' },
  { name: 'PalmPay', code: '999991' },
  { name: 'Kuda Bank', code: '50211' },
];

// How long before its real expiry we treat a cached OAuth token as stale, mirroring
// moniepoint.service.ts's TOKEN_REFRESH_BUFFER_MS.
const TOKEN_REFRESH_BUFFER_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

@Injectable()
export class MonnifyService {
  private readonly logger = new Logger(MonnifyService.name);
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly secretKey?: string;
  private readonly contractCode?: string;
  private readonly relayUrl?: string;
  private readonly relaySharedSecret?: string;

  // Single platform-level credential (see configuration.ts's monnifyConfig comment) — one cached
  // token shared across every workspace's outbound calls, not per-workspace.
  private cachedToken: CachedToken | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => WalletService))
    private readonly walletService: WalletService,
  ) {
    this.baseUrl = this.configService.get<string>('monnify.baseUrl') || 'https://sandbox.monnify.com';
    this.apiKey = this.configService.get<string>('monnify.apiKey');
    this.secretKey = this.configService.get<string>('monnify.secretKey');
    this.contractCode = this.configService.get<string>('monnify.contractCode');
    this.relayUrl = this.configService.get<string>('monnify.relayUrl');
    this.relaySharedSecret = this.configService.get<string>('monnify.relaySharedSecret');
  }

  private get isMockMode(): boolean {
    return this.configService.get<boolean>('monnify.mockMode') === true;
  }

  /**
   * Single low-level HTTP entrypoint for every real Monnify call. If MONNIFY_RELAY_URL is set,
   * requests are forwarded through that relay (POST {relayUrl}/forward with the target
   * path/method/body/baseUrl, authenticated via the `x-relay-secret` header) instead of hitting
   * Monnify directly — see configuration.ts's comment on why (Railway doesn't guarantee a static
   * outbound IP, and Monnify disbursement calls require the platform's contract IP to be
   * whitelisted). Contract matches monnify-relay/index.js exactly: it only exposes `POST /forward`
   * and `GET /health`, checks `x-relay-secret` (not Authorization), and expects a JSON body of
   * `{ method, path, headers, body, baseUrl }`.
   */
  private async rawRequest<T>(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    if (this.relayUrl) {
      const res = await fetch(`${this.relayUrl.replace(/\/$/, '')}/forward`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-relay-secret': this.relaySharedSecret ?? '',
        },
        body: JSON.stringify({ method, path, headers: extraHeaders, body, baseUrl: this.baseUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.logger.error(`Monnify relay error on ${path}: status=${res.status} body=${JSON.stringify(data)}`);
        throw new BadRequestException((data as any)?.responseMessage || (data as any)?.message || `Monnify relay error (${res.status})`);
      }
      return data as T;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.logger.error(`Monnify API error on ${path}: status=${res.status} body=${JSON.stringify(data)}`);
      throw new BadRequestException((data as any)?.responseMessage || (data as any)?.message || `Monnify API error (${res.status})`);
    }
    return data as T;
  }

  /**
   * OAuth token fetch+cache. Best-effort per Monnify's documented auth flow (POST
   * /api/v1/auth/login with HTTP Basic auth of apiKey:secretKey, returning
   * { requestSuccessful, responseBody: { accessToken, expiresIn } }) — structured in the same
   * "unconfirmed, needs real-sandbox verification" spirit as moniepoint.service.ts's auth
   * comments, since this hasn't been run against a live Monnify contract from here.
   */
  private async getAccessToken(): Promise<string> {
    if (this.isMockMode) return 'mock-access-token';

    if (this.cachedToken && this.cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
      return this.cachedToken.accessToken;
    }

    if (!this.apiKey || !this.secretKey) {
      throw new BadRequestException('Monnify API credentials are not configured');
    }

    const basic = Buffer.from(`${this.apiKey}:${this.secretKey}`).toString('base64');
    const result = await this.rawRequest<{
      requestSuccessful: boolean;
      responseBody: { accessToken: string; expiresIn: number };
    }>('/api/v1/auth/login', 'POST', undefined, { Authorization: `Basic ${basic}` });

    const { accessToken, expiresIn } = result.responseBody;
    this.cachedToken = { accessToken, expiresAt: Date.now() + expiresIn * 1000 };
    return accessToken;
  }

  private async authedRequest<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const token = await this.getAccessToken();
    return this.rawRequest<T>(path, method, body, { Authorization: `Bearer ${token}` });
  }

  async listBanks(): Promise<MonnifyBank[]> {
    if (this.isMockMode) return FALLBACK_BANKS;

    try {
      const result = await this.authedRequest<{
        responseBody: { name: string; code: string }[];
      }>('/api/v1/banks', 'GET');
      return result.responseBody.map((b) => ({ name: b.name, code: b.code }));
    } catch (error) {
      this.logger.warn(`Monnify GET /api/v1/banks failed, falling back to static list: ${error instanceof Error ? error.message : 'unknown error'}`);
      return FALLBACK_BANKS;
    }
  }

  async verifyBankAccount(accountNumber: string, bankCode: string): Promise<VerifyBankAccountResult> {
    if (this.isMockMode) {
      return { accountNumber, accountName: `Mock Account ${accountNumber.slice(-4)}`, bankCode };
    }

    const result = await this.authedRequest<{
      responseBody: { accountNumber: string; accountName: string; bankCode: string };
    }>(`/api/v1/disbursements/account/validate?accountNumber=${accountNumber}&bankCode=${bankCode}`, 'GET');

    return {
      accountNumber: result.responseBody.accountNumber,
      accountName: result.responseBody.accountName,
      bankCode: result.responseBody.bankCode ?? bankCode,
    };
  }

  /**
   * Fans out one Monnify "single transfer" (disbursement) call per BatchItem — a batch disburses
   * as N individual transfers, never one bulk call (see BatchesService.disburse). Best-effort per
   * Monnify's documented v2 single-transfer / v1 auth pattern, matching moniepoint.service.ts's
   * posture of flagging what's confirmed vs. an educated guess: the endpoint path, Bearer-token
   * auth, and payload field names below are per Monnify's public disbursement docs, but have not
   * been exercised against a live sandbox from this environment.
   */
  async initiateSingleTransfer(params: InitiateSingleTransferParams): Promise<InitiateSingleTransferResult> {
    if (this.isMockMode) {
      this.logger.log(`[MOCK] Simulating Monnify single transfer ref=${params.reference} amount=${params.amount}`);
      const result: InitiateSingleTransferResult = { reference: params.reference, status: 'PENDING' };
      // Stands in for the real disbursement webhook — see MonnifyController#handleWebhook.
      setTimeout(() => {
        this.simulateDisbursementWebhook(params.reference, params.amount).catch((err) =>
          this.logger.error(`Mock Monnify disbursement completion failed for ${params.reference}: ${err.message}`),
        );
      }, 4000);
      return result;
    }

    const result = await this.authedRequest<{
      responseBody: { reference: string; status: string; transactionReference?: string };
    }>('/api/v2/disbursements/single', 'POST', {
      amount: params.amount,
      reference: params.reference,
      narration: params.narration,
      destinationBankCode: params.destinationBankCode,
      destinationAccountNumber: params.destinationAccountNumber,
      currency: 'NGN',
      sourceAccountNumber: params.sourceAccountNumber,
    });

    return {
      reference: result.responseBody.reference,
      status: (result.responseBody.status as InitiateSingleTransferResult['status']) ?? 'PENDING',
      monnifyTransactionReference: result.responseBody.transactionReference,
    };
  }

  /**
   * Provisions a workspace's own dedicated collections account (Monnify's Reserved Accounts
   * product) so top-ups/sweeps land in an account the platform can attribute back to that
   * workspace. Best-effort per Monnify's documented Reserved Accounts API — unconfirmed against
   * a live sandbox.
   */
  async createReservedAccount(workspaceId: string, accountName: string): Promise<CreateReservedAccountResult> {
    if (this.isMockMode) {
      return {
        accountReference: workspaceId,
        accountNumber: `90${Date.now().toString().slice(-8)}`,
        bankName: 'Moniepoint MFB (mock)',
        bankCode: '50515',
      };
    }

    if (!this.contractCode) {
      throw new BadRequestException('Monnify contract code is not configured');
    }

    const result = await this.authedRequest<{
      responseBody: {
        accountReference: string;
        accounts: { bankName: string; bankCode: string; accountNumber: string }[];
      };
    }>('/api/v1/bank-transfer/reserved-accounts', 'POST', {
      accountReference: workspaceId,
      accountName,
      currencyCode: 'NGN',
      contractCode: this.contractCode,
      customerEmail: `workspace-${workspaceId}@paidinfull.app`,
      customerName: accountName,
      getAllAvailableBanks: false,
    });

    const account = result.responseBody.accounts[0];
    return {
      accountReference: result.responseBody.accountReference,
      accountNumber: account.accountNumber,
      bankName: account.bankName,
      bankCode: account.bankCode,
    };
  }

  /** Used by WalletService.topUp for a card-charge / one-off virtual account top-up reference. */
  async initializeTransaction(params: InitializeTransactionParams): Promise<InitializeTransactionResult> {
    if (this.isMockMode) {
      const reference = params.reference;
      setTimeout(() => {
        this.simulateCollectionWebhook(reference, params.amount).catch((err) =>
          this.logger.error(`Mock Monnify top-up completion failed for ${reference}: ${err.message}`),
        );
      }, 4000);
      return { reference, checkoutUrl: `https://sandbox.monnify.com/mock-checkout/${reference}` };
    }

    if (!this.contractCode) {
      throw new BadRequestException('Monnify contract code is not configured');
    }

    const result = await this.authedRequest<{
      responseBody: { transactionReference: string; checkoutUrl?: string };
    }>('/api/v1/merchant/transactions/init-transaction', 'POST', {
      amount: params.amount,
      customerName: params.customerName,
      customerEmail: params.customerEmail,
      paymentReference: params.reference,
      paymentDescription: 'Wallet top-up',
      currencyCode: 'NGN',
      contractCode: this.contractCode,
      redirectUrl: params.redirectUrl,
    });

    return { reference: result.responseBody.transactionReference, checkoutUrl: result.responseBody.checkoutUrl };
  }

  /**
   * Best-effort webhook signature check. Monnify's docs describe a "monnify-signature" header
   * computed as HMAC-SHA512 of the raw response/request body using the secret key — the exact
   * signed-string format (whole raw body vs. a specific field concatenation) is NOT confirmed
   * against a real delivery from here, so — same posture as moniepoint.service.ts's SECURITY GAP
   * — this logs a computed-vs-received mismatch rather than rejecting the webhook.
   */
  verifyWebhookSignature(rawBody: string, receivedSignature: string | undefined): boolean {
    if (!this.secretKey || !receivedSignature) return false;
    const computed = createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    if (computed !== receivedSignature) {
      this.logger.warn(
        `Monnify webhook signature MISMATCH — received="${receivedSignature}" computed="${computed}". ` +
          'Not rejecting yet (signed-string format unconfirmed — see SECURITY GAP in MonnifyService.verifyWebhookSignature).',
      );
      return false;
    }
    return true;
  }

  /**
   * Parses and routes a real Monnify webhook delivery. Payload shape per Monnify's docs: a flat
   * body with `eventType` (e.g. "SUCCESSFUL_TRANSACTION" for a collection, "SUCCESSFUL_DISBURSEMENT"
   * / "FAILED_DISBURSEMENT" for a payout) and an `eventData` object carrying the reference(s).
   * Field names for the disbursement event are a best-effort guess (transactionReference /
   * reference), same caveat as elsewhere in this service.
   */
  async processWebhook(rawBody: string, signatureHeader: string | undefined): Promise<{ received: boolean; handled?: string }> {
    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Invalid JSON payload');
    }

    this.verifyWebhookSignature(rawBody, signatureHeader);

    const eventType: string | undefined = parsed?.eventType;
    const data = parsed?.eventData ?? parsed?.data ?? {};

    if (typeof eventType === 'string' && eventType.toUpperCase().includes('DISBURSEMENT')) {
      const reference: string | undefined = data.reference ?? data.transactionReference;
      const status: string | undefined = data.status ?? (eventType.toUpperCase().includes('FAILED') ? 'FAILED' : 'SUCCESS');
      if (!reference) {
        this.logger.warn(`Monnify disbursement webhook missing reference — payload=${rawBody}`);
        return { received: true };
      }
      await this.handleDisbursementResult(reference, status === 'FAILED' ? 'FAILED' : 'SUCCESS', data.responseMessage);
      return { received: true, handled: 'DISBURSEMENT' };
    }

    if (typeof eventType === 'string' && (eventType.toUpperCase().includes('TRANSACTION') || eventType.toUpperCase().includes('COLLECTION'))) {
      const reference: string | undefined = data.paymentReference ?? data.transactionReference;
      const amount = Number(data.amountPaid ?? data.amount ?? 0);
      const accountReference: string | undefined = data.accountReference ?? data.product?.reference;
      const sourceAccountNumber: string | undefined = data.sourceAccountNumber ?? data.payer?.accountNumber;
      const sourceAccountName: string | undefined = data.sourceAccountName ?? data.payer?.name;

      if (!reference || !amount) {
        this.logger.warn(`Monnify collection webhook missing reference/amount — payload=${rawBody}`);
        return { received: true };
      }

      await this.handleCollectionResult({ reference, amount, accountReference, sourceAccountNumber, sourceAccountName });
      return { received: true, handled: 'COLLECTION' };
    }

    this.logger.log(`Monnify webhook with unhandled eventType="${eventType}" — ignored`);
    return { received: true };
  }

  private async handleDisbursementResult(monnifyReference: string, status: 'SUCCESS' | 'FAILED', failureReason?: string) {
    const payout = await this.prisma.batchItemPayout.findUnique({ where: { monnifyReference } });
    if (!payout) {
      this.logger.warn(`Monnify disbursement webhook for unknown reference ${monnifyReference}`);
      return;
    }
    if (payout.status !== 'PENDING' && payout.status !== 'PROCESSING') {
      this.logger.log(`BatchItemPayout ${payout.id} already resolved (${payout.status}), skipping`);
      return;
    }

    await this.prisma.batchItemPayout.update({
      where: { id: payout.id },
      data: {
        status,
        failureReason: status === 'FAILED' ? failureReason ?? 'Declined by Monnify' : null,
        completedAt: new Date(),
      },
    });

    const batchItem = await this.prisma.batchItem.findUnique({ where: { id: payout.batchItemId } });
    if (!batchItem) return;

    const siblingPayouts = await this.prisma.batchItemPayout.findMany({
      where: { batchItem: { batchId: batchItem.batchId } },
    });

    const allResolved = siblingPayouts.every((p) => p.status === 'SUCCESS' || p.status === 'FAILED' || p.status === 'REVERSED');
    if (!allResolved) return;

    const anyFailed = siblingPayouts.some((p) => p.status === 'FAILED' || p.status === 'REVERSED');
    await this.prisma.batch.update({
      where: { id: batchItem.batchId },
      data: { status: anyFailed ? 'PARTIALLY_FAILED' : 'DISBURSED', disbursedAt: new Date() },
    });
    this.logger.log(`Batch ${batchItem.batchId} resolved as ${anyFailed ? 'PARTIALLY_FAILED' : 'DISBURSED'}`);
  }

  private async handleCollectionResult(params: {
    reference: string;
    amount: number;
    accountReference?: string;
    sourceAccountNumber?: string;
    sourceAccountName?: string;
  }) {
    // A collection can be either a one-off card/virtual-account top-up (WalletTopup, keyed by our
    // own generated reference) or an unprompted transfer into the workspace's reserved account
    // (WalletSweep, keyed by the workspace's monnifyReservedAccountRef == accountReference).
    const topup = await this.prisma.walletTopup.findUnique({ where: { monnifyReference: params.reference } });
    if (topup) {
      if (topup.status === 'SUCCESS') return;
      await this.prisma.walletTopup.update({
        where: { id: topup.id },
        data: { status: 'SUCCESS', completedAt: new Date() },
      });
      await this.walletService.recordSweep(topup.workspaceId, {
        monnifyReference: params.reference,
        amount: params.amount,
        sourceAccountNumber: params.sourceAccountNumber,
        sourceAccountName: params.sourceAccountName,
      });
      return;
    }

    if (!params.accountReference) {
      this.logger.warn(`Monnify collection webhook for ${params.reference} matched no WalletTopup and carries no accountReference — cannot attribute to a workspace`);
      return;
    }

    const workspace = await this.prisma.workspace.findFirst({
      where: { OR: [{ monnifyReservedAccountRef: params.accountReference }, { id: params.accountReference }] },
    });
    if (!workspace) {
      this.logger.warn(`Monnify collection webhook accountReference=${params.accountReference} matched no workspace`);
      return;
    }

    await this.walletService.recordSweep(workspace.id, {
      monnifyReference: params.reference,
      amount: params.amount,
      sourceAccountNumber: params.sourceAccountNumber,
      sourceAccountName: params.sourceAccountName,
    });
  }

  private async simulateDisbursementWebhook(reference: string, _amount: number) {
    await this.handleDisbursementResult(reference, 'SUCCESS');
  }

  private async simulateCollectionWebhook(reference: string, amount: number) {
    await this.handleCollectionResult({ reference, amount });
  }
}
