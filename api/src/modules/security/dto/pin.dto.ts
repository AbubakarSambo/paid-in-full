import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class SetPinDto {
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'PIN must be 4–8 digits.' })
  pin: string;

  /** Required when changing an existing PIN. */
  @IsOptional()
  @IsString()
  currentPin?: string;
}

export class ResetPinDto {
  @IsString()
  @MinLength(1)
  password: string;

  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'PIN must be 4–8 digits.' })
  pin: string;
}

export class VerifyPinDto {
  @IsString()
  pin: string;
}
