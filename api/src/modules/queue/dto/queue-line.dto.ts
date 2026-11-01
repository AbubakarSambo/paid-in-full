import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One payable line (Add Queue Item modal / quick-add grid row). */
export class QueueLineDto {
  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty()
  @IsUUID()
  vendorId: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description: string;

  @ApiProperty()
  @IsUUID()
  payCategoryId: string;

  @ApiProperty()
  @IsUUID()
  coaTagId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  units?: number;

  @ApiPropertyOptional({ example: 'Bag' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  unitName?: string;

  @ApiProperty({ minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  unitAmount: number;

  @ApiPropertyOptional({ example: '2026-10', description: 'P&L (activity) month' })
  @IsOptional()
  @Matches(PERIOD, { message: 'pnlPeriod must be YYYY-MM' })
  pnlPeriod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isUrgent?: boolean;

  @ApiPropertyOptional({ description: 'Manual WHT rate 0–1 (approver only). null clears an override on edit.' })
  @IsOptional()
  @ValidateIf((o) => o.whtRateOverride !== null)
  @IsNumber()
  @Min(0)
  @Max(1)
  whtRateOverride?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  invoiceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  invoiceDate?: string;
}

export class CreateQueueItemDto extends QueueLineDto {
  @ApiPropertyOptional({ description: 'Set after the duplicate warning to add anyway' })
  @IsOptional()
  @IsBoolean()
  confirmDuplicate?: boolean;
}

export class UpdateQueueItemDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vendorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() payCategoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() coaTagId?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((o) => o.costCenterId !== null) @IsUUID() costCenterId?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((o) => o.locationId !== null) @IsUUID() locationId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0.001) units?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) unitName?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0.01) unitAmount?: number;
  @ApiPropertyOptional() @IsOptional() @Matches(PERIOD, { message: 'pnlPeriod must be YYYY-MM' }) pnlPeriod?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isUrgent?: boolean;

  @ApiPropertyOptional({ description: 'Manual WHT rate 0–1 (approver only); null removes the override' })
  @IsOptional()
  @ValidateIf((o) => o.whtRateOverride !== null)
  @IsNumber()
  @Min(0)
  @Max(1)
  whtRateOverride?: number | null;

  @ApiPropertyOptional({ description: 'Renames the bundle (applies to every line in it)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  bundleLabel?: string;

  @ApiPropertyOptional({ description: 'Required when the total changes' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  amountChangeReason?: string;
}

export class BulkCreateQueueDto {
  @ApiProperty({ type: [QueueLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => QueueLineDto)
  rows: QueueLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  confirmDuplicates?: boolean;
}

export class BundleSubItemDto {
  @ApiProperty() @IsUUID() vendorId: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) description: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0.001) units?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) unitName?: string;
  @ApiProperty() @IsNumber() @Min(0.01) unitAmount: number;
}

export class CreateBundleDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) bundleLabel: string;
  @ApiProperty() @IsUUID() payCategoryId: string;
  @ApiProperty() @IsUUID() coaTagId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() costCenterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(PERIOD, { message: 'pnlPeriod must be YYYY-MM' }) pnlPeriod?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isUrgent?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) whtRateOverride?: number;

  @ApiProperty({ type: [BundleSubItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BundleSubItemDto)
  items: BundleSubItemDto[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirmDuplicate?: boolean;
}

export class AddBundleItemsDto {
  @ApiProperty({ type: [BundleSubItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BundleSubItemDto)
  items: BundleSubItemDto[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirmDuplicate?: boolean;
}

export class RenameBundleDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) bundleLabel: string;
}

export class BundleUrgentDto {
  @ApiProperty() @IsBoolean() isUrgent: boolean;
}

export class SplitLineDto {
  @ApiProperty() @IsNumber() @Min(0.01) amount: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class SplitQueueItemDto {
  @ApiPropertyOptional({ description: 'Split evenly into N lines (2–50)' })
  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(50)
  parts?: number;

  @ApiPropertyOptional({ type: [SplitLineDto], description: 'Custom amounts; must add up to the original total' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SplitLineDto)
  lines?: SplitLineDto[];
}

export class RejectQueueItemDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(500) reason: string;
}

export class AddCommentDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) body: string;
}

export class QueueQueryDto {
  @ApiPropertyOptional({ description: 'Search vendor, description, bundle' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ obj, key }) => obj[key] === true || obj[key] === 'true' || obj[key] === '1')
  @IsBoolean()
  urgentOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only vendors missing a TIN or phone' })
  @IsOptional()
  @Transform(({ obj, key }) => obj[key] === true || obj[key] === 'true' || obj[key] === '1')
  @IsBoolean()
  noTinOnly?: boolean;
}

export class CsvTextDto {
  @ApiProperty({
    description:
      'CSV text. Columns: Date,Vendor,Description,Category,COA,Business Unit,BU Head,Units,Unit Name,Unit Amount,Activity Month,Urgent',
  })
  @IsString()
  @MinLength(1)
  csv: string;

  @ApiPropertyOptional({ description: 'Import rows flagged as possible duplicates too' })
  @IsOptional()
  @IsBoolean()
  confirmDuplicates?: boolean;
}

export class ApproveQueueItemsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  queueItemIds: string[];

  @ApiProperty()
  @IsUUID()
  payCategoryId: string;

  @ApiPropertyOptional({ description: 'Editable batch ref; generated as "{CAT4} BATCH {YY}{MM}{SEQ3}" when omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  baseRef?: string;

  @ApiPropertyOptional({ description: 'Proceed even though budget caps would be exceeded (audited)' })
  @IsOptional()
  @IsBoolean()
  budgetOverride?: boolean;
}

export class BudgetCheckDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  queueItemIds: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  payCategoryId?: string;
}
