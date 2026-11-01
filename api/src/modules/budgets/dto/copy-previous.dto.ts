import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID, Matches } from 'class-validator';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CopyPreviousBudgetsDto {
  @ApiProperty({ example: '2026-11', description: 'Target month; caps are copied from the month before' })
  @Matches(PERIOD_PATTERN, { message: 'period must be in YYYY-MM format' })
  period: string;

  @ApiPropertyOptional({ description: 'Only copy this Business Unit (omit for every BU)' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional({ default: false, description: 'Overwrite caps that already exist in the target month' })
  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}
