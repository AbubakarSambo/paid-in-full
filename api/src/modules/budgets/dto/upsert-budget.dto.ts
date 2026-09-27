import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Matches, Min } from 'class-validator';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class UpsertBudgetDto {
  @ApiProperty({ description: 'Pay category id' })
  @IsUUID()
  payCategoryId: string;

  @ApiPropertyOptional({ description: 'Cost center id (optional)' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiProperty({ example: '2024-01', description: 'Month this budget applies to, YYYY-MM' })
  @Matches(PERIOD_PATTERN, { message: 'period must be in YYYY-MM format' })
  period: string;

  @ApiProperty({ example: 500000 })
  @IsNumber()
  @Min(0)
  amount: number;
}
