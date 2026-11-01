import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const VARIANCE_PRESETS = ['mtd', 'this_month', 'last_month', 'last_30', 'last_90', 'ytd', 'custom'] as const;
export type VariancePreset = (typeof VARIANCE_PRESETS)[number];

export class VarianceQueryDto {
  @ApiPropertyOptional({ enum: VARIANCE_PRESETS, default: 'this_month' })
  @IsOptional()
  @IsIn(VARIANCE_PRESETS as unknown as string[])
  preset?: VariancePreset;

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Custom range start (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Custom range end (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ description: "Business Unit id, 'none' for lines without a BU, omit for all" })
  @IsOptional()
  @IsString()
  costCenterId?: string;
}
