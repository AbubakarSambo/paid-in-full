import { IsIn, IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const REPORT_PERIODS = ['this_month', 'last_month', 'ytd', 'all', 'custom'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Reports period chips (spec §5.6): This Month · Last Month · Year to Date · All Time · Custom. */
export class ReportQueryDto {
  @ApiPropertyOptional({ enum: REPORT_PERIODS, default: 'this_month' })
  @IsOptional()
  @IsIn(REPORT_PERIODS as unknown as string[])
  period?: ReportPeriod;

  @ApiPropertyOptional({ description: 'Custom period start (YYYY-MM-DD, inclusive)', example: '2026-01-01' })
  @IsOptional()
  @Matches(YMD, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ description: 'Custom period end (YYYY-MM-DD, inclusive)', example: '2026-03-31' })
  @IsOptional()
  @Matches(YMD, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class VendorDebtQueryDto {
  @ApiPropertyOptional({ description: 'Month end to report "as at" (YYYY-MM). Defaults to the current month.', example: '2026-09' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'asOf must be YYYY-MM' })
  asOf?: string;
}
