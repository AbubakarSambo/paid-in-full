import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Step 1–2 of the import wizard: parse CSV and propose label/amount columns + COA matches. */
export class BudgetImportPreviewDto {
  @ApiProperty({ example: 'Cost line,Budget\nDiesel,500000\nCleaning,120000' })
  @IsString()
  @MinLength(1)
  csv: string;

  @ApiPropertyOptional({ description: 'Zero-based column index holding the cost line label' })
  @IsOptional()
  @IsInt()
  @Min(0)
  labelColumn?: number;

  @ApiPropertyOptional({ description: 'Zero-based column index holding the amount' })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountColumn?: number;

  @ApiPropertyOptional({ description: 'Whether the first row is a header (auto-detected when omitted)' })
  @IsOptional()
  @IsBoolean()
  hasHeader?: boolean;
}

export class BudgetImportRowDto {
  @ApiProperty()
  @IsString()
  label: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ description: 'Existing COA tag to map this row to' })
  @IsOptional()
  @IsUUID()
  coaTagId?: string;

  @ApiPropertyOptional({ description: 'Create a new COA tag with this name instead' })
  @IsOptional()
  @IsString()
  newTagName?: string;

  @ApiPropertyOptional({ description: 'Category for the new tag (defaults to the first budgeted category)' })
  @IsOptional()
  @IsUUID()
  payCategoryId?: string;
}

/** Step 3: commit the mapped rows as caps for one month / BU. */
export class BudgetImportCommitDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(PERIOD_PATTERN, { message: 'period must be in YYYY-MM format' })
  period: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiProperty({ type: [BudgetImportRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BudgetImportRowDto)
  rows: BudgetImportRowDto[];
}
