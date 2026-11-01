import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Matches, Min } from 'class-validator';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class UpsertBudgetDto {
  @ApiProperty({ description: 'COA tag id the monthly cap applies to' })
  @IsUUID()
  coaTagId: string;

  @ApiPropertyOptional({ description: 'Business unit (cost center) id; omit for a workspace-wide cap' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiProperty({ example: '2024-01', description: 'Month this budget applies to, YYYY-MM' })
  @Matches(PERIOD_PATTERN, { message: 'period must be in YYYY-MM format' })
  period: string;

  @ApiProperty({ example: 500000, description: 'Monthly cap' })
  @IsNumber()
  @Min(0)
  amount: number;
}
