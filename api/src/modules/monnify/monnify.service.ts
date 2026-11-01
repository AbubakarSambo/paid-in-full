import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException, UnauthorizedException, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { runMonnifyCollectionHooks } from '../invoices/collection-hook';
import { WalletService } from '../wallet/wallet.service';
import { PayoutLedgerService } from '../wallet/payout-ledger.service';
import {
  CreateReservedAccountParams,
  CreateReservedAccountResult,
  InitializeTransactionParams,
  InitializeTransactionResult,
  InitiateSingleTransferParams,
  InitiateSingleTransferResult,
  MonnifyBank,
  ReservedAccountDetails,
  ReservedAccountTransaction,
  TransferStatus,
  TransferStatusResult,
  VerifyBankAccountResult,
} from './dto';

/**
 * Error from a Monnify call. httpStatus 0 = the request never got an answer (network/timeout),
 * so the outcome of a money-moving call is unknown.
 */
export class MonnifyRequestError extends BadRequestException {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

/**
 * For a transfer initiation that threw:
 * - NOT_SENT: Monnify answered and refused it (4xx / requestSuccessful=false): safe to mark failed.
 * - DUPLICATE: the reference already exists, so an earlier attempt reached Monnify: awaiting.
 * - UNKNOWN: no definitive answer (network, timeout, 5xx): must not be treated as failed.
 */
export function classifyTransferError(error: unknown): 'NOT_SENT' | 'DUPLICATE' | 'UNKNOWN' {
  if (!(error instanceof MonnifyRequestError)) return 'UNKNOWN';
  if (/duplicate|already exist|already been used|reference.*(exists|used)/i.test(error.message)) return 'DUPLICATE';
  if (error.httpStatus === 0 || error.httpStatus >= 500 || error.httpStatus === 408) return 'UNKNOWN';
  return 'NOT_SENT';
}

function mapTransferStatus(status: string | undefined | null): TransferStatus {
  const s = (status ?? '').toUpperCase();
  if (s === 'SUCCESS' || s === 'SUCCESSFUL' || s === 'COMPLETED') return 'SUCCESS';
  if (s === 'REVERSED' || s === 'REVERSAL') return 'REVERSED';
  if (s === 'FAILED' || s === 'REJECTED' || s === 'EXPIRED' || s === 'CANCELLED' || s === 'DECLINED') return 'FAILED';
  return 'PENDING';
}

function mockNuban(seed: string): string {
  const digits = BigInt(`0x${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`).toString().padStart(8, '0');
  return `90${digits.slice(-8)}`;
}

/** In-process registry backing mock-mode status queries (deterministic per reference). */
const MOCK_TRANSFERS = new Map<string, { status: 'SUCCESS' | 'FAILED'; amount: number }>();

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

function bankNameOf(code: string | undefined | null): string | null {
  if (!code) return null;
  return FALLBACK_BANKS.find((b) => b.code === code)?.name ?? code;
}

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
  /** Platform Monnify wallet that funds disbursements (MONNIFY_SOURCE_ACCOUNT_NUMBER). */
  private readonly sourceAccountNumber?: string;

  // Single platform-level credential (see configuration.ts's monnifyConfig comment) — one cached
  // token shared across every workspace's outbound calls, not per-workspace.
  private cachedToken: CachedToken | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => WalletService))
    private readonly walletService: WalletService,
    @Inject(forwardRef(() => PayoutLedgerService))
    private readonly payoutLedger: PayoutLedgerService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.baseUrl = this.configService.get<string>('monnify.baseUrl') || 'https://sandbox.monnify.com';
    this.apiKey = this.configService.get<string>('monnify.apiKey');
    this.secretKey = this.configService.get<string>('monnify.secretKey');
    this.contractCode = this.configService.get<string>('monnify.contractCode');
    this.relayUrl = this.configService.get<string>('monnify.relayUrl');
    this.relaySharedSecret = this.configService.get<string>('monnify.relaySharedSecret');
    this.sourceAccountNumber = process.env.MONNIFY_SOURCE_ACCOUNT_NUMBER;
  }

  get mockMode(): boolean {
    return this.isMockMode;
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
    let res: Response;
    try {
      res = this.relayUrl
        ? await fetch(`${this.relayUrl.replace(/\/$/, '')}/forward`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-relay-secret': this.relaySharedSecret ?? '' },
            body: JSON.stringify({ method, path, headers: extraHeaders, body, baseUrl: this.baseUrl }),
            signal: AbortSignal.timeout(30_000),
          })
        : await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', ...extraHeaders },
            ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
            signal: AbortSignal.timeout(30_000),
          });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network error';
      this.logger.error(`Monnify ${this.relayUrl ? 'relay ' : ''}request to ${path} got no answer: ${message}`);
      throw new MonnifyRequestError(`Could not reach Monnify: ${message}`, 0);
    }
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      this.logger.error(`Monnify ${this.relayUrl ? 'relay ' : ''}error on ${path}: status=${res.status} body=${JSON.stringify(data)}`);
      throw new MonnifyRequestError(data?.responseMessage || data?.message || `Monnify API error (${res.status})`, res.status, data);
    }
    if (data && data.requestSuccessful === false) {
      this.logger.warn(`Monnify refused ${path}: ${JSON.stringify(data)}`);
      throw new MonnifyRequestError(data.responseMessage || 'Monnify refused the request', 422, data);
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
   * One Monnify single transfer (v2 disbursement). The disbursement service calls this once per
   * transfer leg with a deterministic, idempotent reference. Best-effort per Monnify's public
   * docs (POST /api/v2/disbursements/single, Bearer auth); not yet exercised against a live
   * sandbox from here. ASSUMPTION: transaction 2FA/OTP authorisation is disabled on the
   * contract, otherwise transfers stop at PENDING_AUTHORIZATION (treated as "awaiting").
   *
   * Throws MonnifyRequestError; callers use classifyTransferError() to tell "definitely not
   * sent" from "outcome unknown".
   */
  async initiateSingleTransfer(params: InitiateSingleTransferParams): Promise<InitiateSingleTransferResult> {
    if (this.isMockMode) {
      // Deterministic mock: accounts ending in 0000 are declined, everything else succeeds
      // (asynchronously, via the simulated webhook unless MONNIFY_MOCK_AUTO_COMPLETE=false).
      const declined = params.destinationAccountNumber.endsWith('0000');
      const existing = MOCK_TRANSFERS.get(params.reference);
      if (existing) {
        throw new MonnifyRequestError('Duplicate reference: transfer already exists', 409);
      }
      MOCK_TRANSFERS.set(params.reference, { status: declined ? 'FAILED' : 'SUCCESS', amount: params.amount });
      this.logger.log(`[MOCK] single transfer ref=${params.reference} amount=${params.amount} -> ${declined ? 'FAILED' : 'PENDING'}`);
      if (declined) return { reference: params.reference, status: 'FAILED', message: 'Mock: destination account declined' };
      if (process.env.MONNIFY_MOCK_AUTO_COMPLETE !== 'false') {
        setTimeout(() => {
          this.handleDisbursementEvent(params.reference, 'SUCCESS', undefined, true).catch((err) =>
            this.logger.error(`Mock disbursement completion failed for ${params.reference}: ${err.message}`),
          );
        }, 4000).unref();
      }
      return { reference: params.reference, status: 'PENDING' };
    }

    const result = await this.authedRequest<{
      responseBody: { reference: string; status: string; transactionReference?: string; responseMessage?: string };
    }>('/api/v2/disbursements/single', 'POST', {
      amount: params.amount,
      reference: params.reference,
      narration: params.narration.slice(0, 100),
      destinationBankCode: params.destinationBankCode,
      destinationAccountNumber: params.destinationAccountNumber,
      destinationAccountName: params.destinationAccountName,
      currency: 'NGN',
      sourceAccountNumber: params.sourceAccountNumber ?? this.sourceAccountNumber,
    });

    return {
      reference: result.responseBody.reference ?? params.reference,
      status: mapTransferStatus(result.responseBody.status) === 'SUCCESS'
        ? 'SUCCESS'
        : mapTransferStatus(result.responseBody.status) === 'FAILED'
          ? 'FAILED'
          : 'PENDING',
      monnifyTransactionReference: result.responseBody.transactionReference,
      message: result.responseBody.responseMessage,
      raw: result.responseBody,
    };
  }

  /**
   * Re-queries one transfer (GET /api/v2/disbursements/single/summary?reference=). A "not found"
   * answer is returned as NOT_FOUND; anything else that fails is thrown (outcome unknown).
   * Mock mode answers from the in-process registry: sent references resolve to their
   * deterministic outcome, unknown references are NOT_FOUND.
   */
  async getTransferStatus(reference: string): Promise<TransferStatusResult> {
    if (this.isMockMode) {
      const t = MOCK_TRANSFERS.get(reference);
      if (!t) return { status: 'NOT_FOUND', message: 'Mock: no transfer with this reference' };
      return { status: t.status, message: t.status === 'FAILED' ? 'Mock: destination account declined' : undefined };
    }
    try {
      const result = await this.authedRequest<{
        responseBody: { status: string; reference: string; amount?: number; responseMessage?: string };
      }>(`/api/v2/disbursements/single/summary?reference=${encodeURIComponent(reference)}`, 'GET');
      return {
        status: mapTransferStatus(result.responseBody?.status),
        message: result.responseBody?.responseMessage,
        raw: result.responseBody,
      };
    } catch (error) {
      if (error instanceof MonnifyRequestError && (error.httpStatus === 404 || /not\s*found|could not find|does not exist/i.test(error.message))) {
        return { status: 'NOT_FOUND', message: error.message };
      }
      throw error;
    }
  }

  /**
   * Monnify Reserved Accounts v2 (POST /api/v2/bank-transfer/reserved-accounts). BVN or NIN is
   * mandatory under current CBN rules. Unconfirmed against a live sandbox.
   */
  async createReservedAccount(params: CreateReservedAccountParams): Promise<CreateReservedAccountResult> {
    if (this.isMockMode) {
      return {
        accountReference: params.accountReference,
        accountNumber: mockNuban(params.accountReference),
        accountName: params.accountName,
        bankName: 'Moniepoint MFB (mock)',
        bankCode: '50515',
        contractCode: params.contractCode ?? 'MOCK-CONTRACT',
      };
    }
    const contractCode = params.contractCode ?? this.contractCode;
    if (!contractCode) throw new BadRequestException('Monnify contract code is not configured');

    const result = await this.authedRequest<{
      responseBody: {
        accountReference: string;
        accountName?: string;
        contractCode?: string;
        accounts: { bankName: string; bankCode: string; accountNumber: string; accountName?: string }[];
      };
    }>('/api/v2/bank-transfer/reserved-accounts', 'POST', {
      accountReference: params.accountReference,
      accountName: params.accountName,
      currencyCode: params.currencyCode ?? 'NGN',
      contractCode,
      customerEmail: params.customerEmail,
      customerName: params.customerName,
      ...(params.bvn && { bvn: params.bvn }),
      ...(params.nin && { nin: params.nin }),
      getAllAvailableBanks: false,
      preferredBanks: ['50515'],
    });

    const account = result.responseBody.accounts[0];
    return {
      accountReference: result.responseBody.accountReference,
      accountNumber: account.accountNumber,
      accountName: account.accountName ?? result.responseBody.accountName,
      bankName: account.bankName,
      bankCode: account.bankCode,
      contractCode: result.responseBody.contractCode ?? contractCode,
    };
  }

  /** GET /api/v2/bank-transfer/reserved-accounts/{accountReference}; null when Monnify has none. */
  async getReservedAccount(accountReference: string): Promise<ReservedAccountDetails | null> {
    if (this.isMockMode) {
      return {
        accountReference,
        accountName: 'Mock Reserved Account',
        contractCode: 'MOCK-CONTRACT',
        accounts: [{ accountNumber: mockNuban(accountReference), bankName: 'Moniepoint MFB (mock)', bankCode: '50515' }],
      };
    }
    try {
      const result = await this.authedRequest<{
        responseBody: {
          accountReference: string;
          accountName?: string;
          contractCode?: string;
          accounts: { accountNumber: string; bankName?: string; bankCode?: string; accountName?: string }[];
        };
      }>(`/api/v2/bank-transfer/reserved-accounts/${encodeURIComponent(accountReference)}`, 'GET');
      return result.responseBody ?? null;
    } catch (error) {
      if (error instanceof MonnifyRequestError && (error.httpStatus === 404 || /not\s*found|does not exist/i.test(error.message))) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Recent collections on a reserved account (GET /api/v1/bank-transfer/reserved-accounts/
   * transactions). Field names per Monnify docs, unconfirmed live. Mock mode returns one
   * deterministic ₦1,000,000 transfer per day for the last three days.
   */
  async listReservedAccountTransactions(accountReference: string, size = 50): Promise<ReservedAccountTransaction[]> {
    if (this.isMockMode) {
      const tag = createHash('sha256').update(accountReference).digest('hex').slice(0, 6).toUpperCase();
      return [0, 1, 2].map((d) => {
        const day = new Date(Date.now() - d * 86_400_000);
        const ymd = day.toISOString().slice(0, 10).replace(/-/g, '');
        return {
          reference: `MNFY|MOCK|${tag}|${ymd}`,
          amount: 1_000_000,
          status: 'PAID',
          paidAt: new Date(`${day.toISOString().slice(0, 10)}T09:00:00Z`),
          payerName: 'Mock Funding Ltd',
          payerBank: 'Guaranty Trust Bank',
          payerAccountNumber: '0123456789',
        };
      });
    }
    const result = await this.authedRequest<{
      responseBody: {
        content: Array<{
          transactionReference: string;
          paymentReference?: string;
          amount?: number;
          amountPaid?: number;
          paymentStatus?: string;
          completedOn?: string;
          paidOn?: string;
          customerDTO?: { name?: string };
          paymentSourceInformation?: Array<{ accountName?: string; accountNumber?: string; bankCode?: string }>;
        }>;
      };
    }>(`/api/v1/bank-transfer/reserved-accounts/transactions?accountReference=${encodeURIComponent(accountReference)}&page=0&size=${size}`, 'GET');
    return (result.responseBody?.content ?? []).map((t) => {
      const src = t.paymentSourceInformation?.[0];
      return {
        reference: t.transactionReference,
        amount: Number(t.amountPaid ?? t.amount ?? 0),
        status: (t.paymentStatus ?? '').toUpperCase(),
        paidAt: t.completedOn || t.paidOn ? new Date((t.completedOn || t.paidOn) as string) : null,
        payerName: src?.accountName ?? t.customerDTO?.name ?? null,
        payerBank: bankNameOf(src?.bankCode),
        payerAccountNumber: src?.accountNumber ?? null,
      };
    });
  }

  /** GET /api/v2/transactions/{transactionReference}: authoritative check of a collection. */
  async getCollectionStatus(transactionReference: string): Promise<{ paid: boolean; amount: number } | null> {
    if (this.isMockMode) return null;
    try {
      const result = await this.authedRequest<{ responseBody: { paymentStatus?: string; amountPaid?: number } }>(
        `/api/v2/transactions/${encodeURIComponent(transactionReference)}`,
        'GET',
      );
      return {
        paid: (result.responseBody?.paymentStatus ?? '').toUpperCase() === 'PAID',
        amount: Number(result.responseBody?.amountPaid ?? 0),
      };
    } catch (error) {
      if (error instanceof MonnifyRequestError && error.httpStatus === 404) return { paid: false, amount: 0 };
      throw error;
    }
  }

  /** Used by WalletService.topUp for a card-charge / one-off virtual account top-up reference. */
  async initializeTransaction(params: InitializeTransactionParams): Promise<InitializeTransactionResult> {
    if (this.isMockMode) {
      const reference = params.reference;
      setTimeout(() => {
        this.simulateCollectionWebhook(reference, params.amount).catch((err) =>
          this.logger.error(`Mock Monnify top-up completion failed for ${reference}: ${err.message}`),
        );
      }, 4000).unref();
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
   * Monnify signs webhooks with `monnify-signature` = HMAC-SHA512(clientSecret, raw body).
   * A mismatch is rejected only when MONNIFY_ENFORCE_WEBHOOK_SIGNATURE=true; otherwise an
   * unsigned/mismatched webhook is treated as a hint and the outcome is re-queried from the
   * Monnify API before anything is applied (see processWebhook), so a forged payload can never
   * mark a transfer failed (which would make it re-payable) or credit a wallet.
   */
  verifyWebhookSignature(rawBody: string, receivedSignature: string | undefined): boolean {
    if (!this.secretKey || !receivedSignature) return false;
    const computed = createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    const a = Buffer.from(computed);
    const b = Buffer.from(receivedSignature);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) this.logger.warn('Monnify webhook signature mismatch');
    return ok;
  }

  /**
   * Routes a Monnify webhook. Event types per Monnify docs: SUCCESSFUL_TRANSACTION (collection),
   * SUCCESSFUL_DISBURSEMENT / FAILED_DISBURSEMENT / REVERSED_DISBURSEMENT (payouts).
   * Every handler is idempotent: a re-delivered event is a no-op.
   */
  async processWebhook(rawBody: string, signatureHeader: string | undefined): Promise<{ received: boolean; handled?: string }> {
    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Invalid JSON payload');
    }

    const signed = this.verifyWebhookSignature(rawBody, signatureHeader);
    if (!signed && process.env.MONNIFY_ENFORCE_WEBHOOK_SIGNATURE === 'true') {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    const trusted = signed || this.isMockMode;

    const eventType = String(parsed?.eventType ?? '').toUpperCase();
    const data = parsed?.eventData ?? parsed?.data ?? {};

    if (eventType.includes('DISBURSEMENT')) {
      const reference: string | undefined = data.reference ?? data.transactionReference;
      if (!reference) {
        this.logger.warn('Monnify disbursement webhook without a reference — ignored');
        return { received: true };
      }
      const claimed: TransferStatus = eventType.startsWith('REVERSED')
        ? 'REVERSED'
        : eventType.startsWith('FAILED')
          ? 'FAILED'
          : mapTransferStatus(data.status ?? 'SUCCESS');
      await this.handleDisbursementEvent(reference, claimed, data.responseMessage ?? data.transactionDescription, trusted);
      return { received: true, handled: 'DISBURSEMENT' };
    }

    if (eventType.includes('TRANSACTION') || eventType.includes('COLLECTION')) {
      const transactionReference: string | undefined = data.transactionReference;
      const paymentReference: string | undefined = data.paymentReference;
      const amount = Number(data.amountPaid ?? data.amount ?? 0);
      const paymentStatus = String(data.paymentStatus ?? 'PAID').toUpperCase();
      if ((!transactionReference && !paymentReference) || !(amount > 0)) {
        this.logger.warn('Monnify collection webhook without reference/amount — ignored');
        return { received: true };
      }
      if (paymentStatus !== 'PAID' && paymentStatus !== 'OVERPAID') return { received: true, handled: 'IGNORED_UNPAID' };

      let confirmedAmount = amount;
      if (!trusted) {
        const check = await this.getCollectionStatus(transactionReference ?? paymentReference!).catch((e) => {
          throw new ServiceUnavailableException(`Could not verify collection with Monnify: ${(e as Error).message}`);
        });
        if (!check?.paid) {
          this.logger.warn(`Unverified collection webhook ${transactionReference ?? paymentReference} — Monnify does not report it PAID`);
          return { received: true, handled: 'UNVERIFIED' };
        }
        confirmedAmount = check.amount || amount;
      }
      // Invoicing hook (invoices module): per-invoice collection accounts and client-mandate
      // verifications/charges. Runs after verification; claimed events skip wallet handling.
      if (await runMonnifyCollectionHooks({ eventType, data: { ...data, amountPaid: confirmedAmount } })) {
        return { received: true, handled: 'INVOICING' };
      }
      const src = Array.isArray(data.paymentSourceInformation) ? data.paymentSourceInformation[0] : undefined;
      await this.handleCollectionResult({
        transactionReference,
        paymentReference,
        amount: confirmedAmount,
        accountReference: data.product?.reference ?? data.accountReference,
        payerName: src?.accountName ?? data.customer?.name ?? data.sourceAccountName,
        payerAccountNumber: src?.accountNumber ?? data.sourceAccountNumber,
        payerBank: bankNameOf(src?.bankCode),
        paidAt: data.paidOn ? new Date(data.paidOn) : null,
      });
      return { received: true, handled: 'COLLECTION' };
    }

    this.logger.log(`Monnify webhook with unhandled eventType="${eventType}" — ignored`);
    return { received: true };
  }

  /**
   * Applies a disbursement outcome. Untrusted (unsigned, live) events are re-queried: the API's
   * answer is applied instead of the payload's claim; an unreachable API throws 503 so Monnify
   * retries the delivery later.
   */
  async handleDisbursementEvent(reference: string, claimed: TransferStatus, message: string | undefined, trusted: boolean) {
    let status = claimed;
    let msg = message;
    if (!trusted) {
      const check = await this.getTransferStatus(reference).catch((e) => {
        throw new ServiceUnavailableException(`Could not verify transfer with Monnify: ${(e as Error).message}`);
      });
      status = check.status;
      msg = check.message ?? message;
    }
    if (status !== 'SUCCESS' && status !== 'FAILED' && status !== 'REVERSED') {
      this.logger.log(`Disbursement ${reference} still ${status} — nothing to apply`);
      return;
    }
    const res = await this.payoutLedger.applyTransferOutcome(reference, status, { message: msg, confirmed: true, source: 'webhook' });
    if (!res.found) this.logger.warn(`Monnify disbursement event for unknown reference ${reference}`);
  }

  private async handleCollectionResult(params: {
    transactionReference?: string;
    paymentReference?: string;
    amount: number;
    accountReference?: string;
    payerName?: string | null;
    payerBank?: string | null;
    payerAccountNumber?: string | null;
    paidAt?: Date | null;
  }) {
    // 1) A checkout top-up we initiated (WalletTopup keyed by our paymentReference).
    const byOurRef = params.paymentReference
      ? await this.prisma.walletTopup.findUnique({ where: { reference: params.paymentReference } })
      : null;
    if (byOurRef) {
      await this.walletService.recordTopup(byOurRef.workspaceId, {
        reference: byOurRef.reference,
        amount: params.amount,
        payerName: params.payerName,
        payerBank: params.payerBank,
        payerAccountNumber: params.payerAccountNumber,
        paidAt: params.paidAt,
        source: byOurRef.source,
      });
      return;
    }

    // 2) A transfer into a workspace's reserved account (keyed by Monnify's MNFY|... reference).
    if (!params.accountReference) {
      this.logger.warn(`Collection ${params.transactionReference ?? params.paymentReference} matched no top-up and has no account reference`);
      return;
    }
    // 2a) PIF's own subscription billing NUBAN (spec §5.10 #17) → BillingService, not the wallet.
    const billingWs = await this.prisma.workspace.findFirst({
      where: { billingAccountRef: params.accountReference },
      select: { id: true },
    });
    if (billingWs) {
      // Resolved lazily: BillingModule imports MonnifyModule, so a static import would be circular.
      const { BillingService } = await import('../billing/billing.service');
      const billing = this.moduleRef.get(BillingService, { strict: false });
      await billing.recordPifPayment(
        billingWs.id,
        params.amount,
        params.transactionReference ?? params.paymentReference!,
        params.paidAt ?? new Date(),
        null,
      );
      return;
    }

    const workspace = await this.prisma.workspace.findFirst({
      where: { OR: [{ monnifyReservedAccountRef: params.accountReference }, { id: params.accountReference }] },
      select: { id: true },
    });
    if (!workspace) {
      this.logger.warn(`Collection for account reference ${params.accountReference} matched no workspace`);
      return;
    }
    await this.walletService.recordTopup(workspace.id, {
      reference: params.transactionReference ?? params.paymentReference!,
      amount: params.amount,
      payerName: params.payerName,
      payerBank: params.payerBank,
      payerAccountNumber: params.payerAccountNumber,
      paidAt: params.paidAt,
      source: 'WEBHOOK',
    });
  }

  private async simulateCollectionWebhook(reference: string, amount: number) {
    await this.handleCollectionResult({ paymentReference: reference, amount, payerName: 'Mock card payment' });
  }
}
