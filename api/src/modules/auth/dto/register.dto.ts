import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Spec /login "create workspace": name, workspace name, email, password. */
export class RegisterDto {
  @IsString()
  @MinLength(2, { message: 'Workspace name must be at least 2 characters.' })
  @MaxLength(80)
  workspaceName: string;

  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  password: string;

  /** Full name (alternative to firstName/lastName). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;
}
