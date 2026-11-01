import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateCoaTagDto {
  @ApiProperty()
  @IsUUID()
  payCategoryId: string;

  @ApiProperty({ example: 'Fuel & Lubricants' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;
}

export class UpdateCoaTagDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ImportCoaTagsDto {
  @ApiProperty()
  @IsUUID()
  payCategoryId: string;

  @ApiProperty({ description: 'CSV text with a "coa_tag" (or "name") column; header optional', example: 'coa_tag\nRent\nFuel & Lubricants' })
  @IsString()
  @MinLength(1)
  csv: string;
}

export class DefaultSetupDto {
  @ApiPropertyOptional({ description: 'Industry to tailor tags (saved to the workspace). Defaults to the workspace industry.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  industry?: string;

  @ApiPropertyOptional({ description: 'Must be true to replace COA tags that already exist in COS / OPEX / ASSET' })
  @IsOptional()
  @IsBoolean()
  confirmReplace?: boolean;
}

export class SuggestCoaTagsDto {
  @ApiProperty()
  @IsUUID()
  payCategoryId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  industry?: string;

  @ApiPropertyOptional({ default: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
