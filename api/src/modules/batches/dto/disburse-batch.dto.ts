import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class DisburseBatchDto {
  @ApiProperty({ description: 'Client-generated UUID for idempotent retries — a double-tap on Disburse must never double-pay vendors' })
  @IsUUID()
  clientRequestId: string;
}
