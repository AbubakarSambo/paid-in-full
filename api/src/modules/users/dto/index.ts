import { IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '../../../common/decorators/roles.decorator';

export class InviteUserDto {
  @IsString()
  @MinLength(1, { message: 'Enter a name.' })
  @MaxLength(120)
  name: string;

  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;

  @IsEnum(Role)
  role: Role;

  @IsOptional()
  @IsBoolean()
  isBiller?: boolean;
}

export class EditMemberNameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;
}

export class SetRoleDto {
  @IsEnum(Role)
  role: Role;
}

export class SetBillerDto {
  @IsBoolean()
  isBiller: boolean;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  /** "default" (turquoise) | "classic" (gold accent). */
  @IsOptional()
  @IsIn(['default', 'classic'])
  accentSkin?: 'default' | 'classic';

  @IsOptional()
  @IsBoolean()
  onboarded?: boolean;
}

export class ChangePasswordDto {
  /** Not required when the account has no password yet (Google sign-in). */
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  newPassword: string;
}
