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
}

export interface CreateReservedAccountResult {
  accountReference: string;
  accountNumber: string;
  bankName: string;
  bankCode: string;
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
