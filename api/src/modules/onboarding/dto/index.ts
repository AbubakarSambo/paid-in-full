import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Role } from '../../../common/decorators/roles.decorator';
import { WORKSPACE_CURRENCIES } from '../../workspaces/dto/update-workspace.dto';

export class WizardInviteDto {
  @IsEmail({}, { message: 'Enter a valid email for each invite.' })
  email: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsEnum(Role)
  role: Role;
}

/** Spec §2 /onboarding wizard. Every field optional so steps can be skipped. */
export class OnboardingWizardDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  /** URL or data: URL (or upload via POST /workspace/logo first). */
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsIn(WORKSPACE_CURRENCIES as unknown as string[])
  currency?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  industry?: string;

  /** Create Cost of Sale / Operating Expense / Asset categories with starter COA tags. */
  @IsOptional()
  @IsBoolean()
  createDefaultCategories?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => WizardInviteDto)
  invites?: WizardInviteDto[];
}

export class ChecklistStepDto {
  @IsBoolean()
  done: boolean;
}

export class ChecklistDismissDto {
  @IsBoolean()
  dismissed: boolean;
}
