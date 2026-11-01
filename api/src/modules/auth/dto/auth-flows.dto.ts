import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class GoogleSignInDto {
  /** Google Identity Services credential (ID token JWT). */
  @IsString()
  idToken: string;

  /** When the Google email has no account yet: create one with this workspace. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  workspaceName?: string;
}

export class EmailOnlyDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;
}

export class TokenDto {
  @IsString()
  token: string;
}

export class SetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(2, { message: 'Workspace name must be at least 2 characters.' })
  @MaxLength(80)
  name: string;
}
