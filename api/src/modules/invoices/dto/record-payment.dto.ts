import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RecordPaymentDto {
  @ApiProperty({ example: 50000 })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Defaults to now' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  paymentDate?: Date;

  @ApiPropertyOptional({ description: 'Bank/Monnify payment reference' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @ApiPropertyOptional({ enum: ['TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'POS', 'OTHER'] })
  @IsOptional()
  @IsIn(['TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'POS', 'OTHER'])
  method?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Idempotency key: a retried request with the same id is a no-op' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientRequestId?: string;
}
