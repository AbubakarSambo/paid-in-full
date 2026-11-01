import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndef = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value);

export class CreateVendorDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ description: 'Contact name' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  contactPerson?: string;

  @ApiPropertyOptional({ description: 'Contact phone' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndef)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: '10-digit NUBAN' })
  @IsOptional()
  @Transform(emptyToUndef)
  @Matches(/^\d{10}$/, { message: 'Account number must be 10 digits' })
  bankAccountNumber?: string;

  @ApiPropertyOptional({ description: 'CBN / NIP bank code' })
  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  bankCode?: string;

  @ApiPropertyOptional({ description: 'Account name typed by the user (used only when the bank cannot confirm)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  accountName?: string;

  @ApiPropertyOptional({ description: '"Bank can\'t confirm — save with the name I typed" tick-box', default: false })
  @IsOptional()
  @IsBoolean()
  allowUnverified?: boolean;

  @ApiPropertyOptional({ description: "Vendor's FIRS TIN, e.g. 12345678-0001" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  tin?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  whtExempt?: boolean;

  @ApiPropertyOptional({ description: 'Vendor-level WHT override as a fraction (0.05 = 5%); 0/null = none' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  whtRate?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
