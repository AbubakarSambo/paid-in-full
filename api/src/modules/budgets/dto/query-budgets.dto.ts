import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class QueryBudgetsDto {
  @ApiPropertyOptional({ example: '2024-01', description: 'Month to filter by, YYYY-MM' })
  @IsOptional()
  @Matches(PERIOD_PATTERN, { message: 'period must be in YYYY-MM format' })
  period?: string;

  @ApiPropertyOptional({ description: 'Filter by pay category id' })
  @IsOptional()
  @IsUUID()
  payCategoryId?: string;

  @ApiPropertyOptional({ description: 'Filter by cost center id' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;
}
