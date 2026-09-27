import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

// BEST-EFFORT / UNCONFIRMED SHAPE: modeled on Monnify's documented "Transaction Successful"
// transfer/collection webhook (eventType + eventData envelope) since we could not confirm the
// exact payload Monnify sends for a recurring "Initialize Transaction" card charge against a
// sandbox contract. Verify against real Monnify webhook logs before relying on this in prod —
// in particular whether `eventData.paymentReference`/`transactionReference` is what we sent as
// our own reference, and whether failures arrive on this same webhook (paymentStatus: FAILED)
// or via a different event/eventType.
export class MonnifyWebhookDto {
  @ApiProperty({ description: 'e.g. SUCCESSFUL_TRANSACTION (unconfirmed exact enum values)' })
  @IsString()
  eventType: string;

  @ApiProperty({ type: Object })
  @IsObject()
  eventData: {
    transactionReference?: string;
    paymentReference?: string;
    amountPaid?: number | string;
    paidOn?: string;
    paymentStatus?: string; // e.g. PAID | FAILED (unconfirmed)
    metaData?: Record<string, unknown>; // expected to carry { workspaceSubscriptionId }
    [key: string]: unknown;
  };

  @ApiProperty({ required: false, description: 'HMAC-SHA512 signature header, if Monnify sends one (unconfirmed for this webhook type)' })
  @IsOptional()
  @IsString()
  signature?: string;
}
