// Internal shapes used between MonnifyService and its callers (vendors/wallet/batches). These
// are plain interfaces, not class-validator DTOs — nothing in this module accepts a raw HTTP
// body directly except the webhook, which is unvalidated/raw by nature (see MonnifyController).

export interface VerifyBankAccountResult {
  accountNumber: string;
  accountName: string;
  bankCode: string;
}

export interface MonnifyBank {
  name: string;
  code: string;
}

export interface InitiateSingleTransferParams {
  amount: number;
  reference: string;
  narration: string;
  destinationAccountNumber: string;
  destinationBankCode: string;
  destinationAccountName: string;
  sourceAccountNumber?: string;
}

export interface InitiateSingleTransferResult {
  reference: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  monnifyTransactionReference?: string;
  message?: string;
  raw?: unknown;
}

export interface CreateReservedAccountParams {
  accountReference: string;
  accountName: string;
  currencyCode?: string;
  contractCode?: string;
  customerName: string;
  customerEmail: string;
  bvn?: string;
  nin?: string;
}

export interface CreateReservedAccountResult {
  accountReference: string;
  accountNumber: string;
  accountName?: string;
  bankName: string;
  bankCode: string;
  contractCode?: string;
}

export interface ReservedAccountDetails {
  accountReference: string;
  accountName?: string;
  contractCode?: string;
  accounts: { accountNumber: string; bankName?: string; bankCode?: string; accountName?: string }[];
}

export interface ReservedAccountTransaction {
  /** Monnify transactionReference (MNFY|...) — the idempotency key for top-ups. */
  reference: string;
  amount: number;
  status: string; // PAID | PENDING | ...
  paidAt?: Date | null;
  payerName?: string | null;
  payerBank?: string | null;
  payerAccountNumber?: string | null;
}

export type TransferStatus = 'SUCCESS' | 'FAILED' | 'REVERSED' | 'PENDING' | 'NOT_FOUND';

export interface TransferStatusResult {
  status: TransferStatus;
  message?: string;
  raw?: unknown;
}

export interface InitializeTransactionParams {
  amount: number;
  reference: string;
  customerEmail: string;
  customerName: string;
  redirectUrl?: string;
}

export interface InitializeTransactionResult {
  reference: string;
  checkoutUrl?: string;
}
