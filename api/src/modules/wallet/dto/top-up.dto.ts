import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class TopUpDto {
  @ApiProperty({ minimum: 1 })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ description: 'Where to send the checkout redirect once the top-up completes' })
  @IsOptional()
  @IsString()
  redirectUrl?: string;

  @ApiProperty({ description: 'Client-generated UUID for idempotent retries — a double-tap must never create two pending top-ups' })
  @IsUUID()
  clientRequestId: string;
}
