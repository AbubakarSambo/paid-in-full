import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class BudgetOverviewQueryDto {
  @ApiProperty({ example: '2026-10', description: 'Month, YYYY-MM' })
  @Matches(PERIOD_PATTERN, { message: 'period must be in YYYY-MM format' })
  period: string;

  @ApiPropertyOptional({ description: "Business Unit id, 'none' for workspace-wide caps, omit for all BUs aggregated" })
  @IsOptional()
  @IsString()
  costCenterId?: string;
}
