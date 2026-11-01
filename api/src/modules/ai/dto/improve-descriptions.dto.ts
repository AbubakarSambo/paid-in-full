import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class ImproveDescriptionItemDto {
  @ApiPropertyOptional({ description: 'Caller id echoed back (e.g. queue line id) for the review diff' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendorName?: string;

  @ApiPropertyOptional({ description: 'Line date (ISO) — used for the trailing DD/MM/YYYY when the text has none' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number;
}

export class ImproveDescriptionsDto {
  @ApiProperty({ type: [ImproveDescriptionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ImproveDescriptionItemDto)
  items: ImproveDescriptionItemDto[];
}

export class ValidateDescriptionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  description: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendorName?: string;
}

export interface ImprovedDescription {
  id: string | null;
  original: string;
  improved: string;
  changed: boolean;
  /** Rule violations remaining in `improved` (spec §7 messages). */
  errors: string[];
  originalErrors: string[];
  suggestion: {
    payCategoryId: string;
    payCategoryName: string;
    coaTagId: string;
    coaTagName: string;
    confidence: 'high' | 'medium' | 'low';
  } | null;
}
