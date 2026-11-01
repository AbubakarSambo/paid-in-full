import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class UpsertWhtRateDto {
  @ApiProperty({ description: 'COA / category label this default applies to (matched case-insensitively)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  coa: string;

  @ApiProperty({ minimum: 0, maximum: 1, description: 'WHT rate as a fraction (0.05 = 5%)' })
  @IsNumber()
  @Min(0)
  @Max(1)
  rate: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class UpdateWhtRateDto extends PartialType(UpsertWhtRateDto) {}

export class SeedWhtDefaultsDto {
  @ApiPropertyOptional({ description: 'Overwrite existing rows for the same COA with the statutory default', default: false })
  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}

export class ResolveWhtDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ description: 'COA tag name' })
  @IsOptional()
  @IsString()
  coa?: string;

  @ApiPropertyOptional({ description: 'Line total; when given the response includes gross/wht/net' })
  @IsOptional()
  @IsNumber()
  total?: number;
}

export class UpdateWhtAccountDto {
  @ApiProperty({ example: '058' })
  @IsString()
  @Matches(/^\d{3,6}$/, { message: 'bankCode must be a CBN/NIP bank code' })
  bankCode: string;

  @ApiProperty({ example: '0123456789' })
  @Matches(/^\d{10}$/, { message: 'Account number must be 10 digits' })
  accountNumber: string;

  @ApiPropertyOptional({ description: 'Typed name — only used when the bank cannot confirm and allowUnverified is true' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountName?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowUnverified?: boolean;
}
