import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export const WORKSPACE_CURRENCIES = ['NGN', 'USD', 'EUR', 'GBP', 'GHS', 'ZAR', 'KES'] as const;
export const INDUSTRIES = [
  'Hospitality',
  'Clinic/Pharmacy',
  'Professional Services',
  'Logistics/Transport',
  'Retail',
  'Manufacturing',
  'Education',
  'Real Estate',
  'Technology',
  'Other',
] as const;

/** Settings → Workspace / Modules / Security access (spec §5.10 #3, #4, #22). */
export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  /** Absolute URL or data: URL. Prefer POST /workspace/logo for uploads. */
  @IsOptional()
  @IsString()
  logoUrl?: string | null;

  @IsOptional()
  @IsIn(WORKSPACE_CURRENCIES as unknown as string[])
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  industry?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9A-Za-z-]{0,20}$/, { message: 'TIN should be digits/letters only.' })
  tin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  invoicePrefix?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;

  // ── AppConfig-backed settings ──
  @IsOptional()
  @IsBoolean()
  requisitionsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  businessUnitsRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  sessionTimeoutMinutes?: number;

  @IsOptional()
  @IsBoolean()
  requireReauthForDisbursement?: boolean;
}
