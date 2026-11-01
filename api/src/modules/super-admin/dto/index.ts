import { IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { WorkspaceStatus } from '@prisma/client';

export class ListClientsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(WorkspaceStatus)
  status?: WorkspaceStatus;
}

/** Manage modal (spec §14). null clears a field. */
export class ManageClientDto {
  @IsOptional()
  @IsEnum(WorkspaceStatus)
  status?: WorkspaceStatus;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyAmount?: number | null;

  @IsOptional()
  @IsDateString()
  paidUntil?: string | null;

  /** Extend paid-until from max(paidUntil, today). */
  @IsOptional()
  @IsIn(['30d', '90d', '1y'])
  extendPaidUntil?: '30d' | '90d' | '1y';

  @IsOptional()
  @IsDateString()
  trialEndDate?: string | null;

  /** Tier name (e.g. STARTER/GROWTH/ENTERPRISE). Sets monthlyAmount from the plan unless one is given. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tier?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  billingDay?: number | null;

  @IsOptional()
  @IsDateString()
  nextDueDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}

export class DeleteClientDto {
  /** Must match the workspace name. */
  @IsString()
  confirmName: string;
}

export class NewClientDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  businessName: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{2,48}$/, { message: 'Slug: lowercase letters, numbers and dashes only.' })
  slug?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  adminName: string;

  @IsEmail({}, { message: 'Enter a valid admin email.' })
  adminEmail: string;

  /** Ignored for CLIENT_SETUP staff (no money access). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyAmount?: number;
}

export class TeamEmailDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;
}
