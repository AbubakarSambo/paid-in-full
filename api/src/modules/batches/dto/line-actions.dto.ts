import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';

export class RetryLinesDto {
  @ApiPropertyOptional({ type: [String], description: 'Lines to reset; omit for "Retry all"' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  itemIds?: string[];
}

export class SplitLineDto {
  @ApiProperty({ description: 'Amount that stays on this line (pay now); the remainder becomes a new line' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  payNowAmount: number;

  @ApiPropertyOptional({ description: 'Description for the new remainder line' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  remainderDescription?: string;
}

export class ReclassifyLineDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  coaTagId?: string;

  @ApiPropertyOptional({ example: '2026-10' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  pnlPeriod?: string;

  @ApiPropertyOptional({ description: 'Change vendor: bank details are re-snapshotted from the register' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description?: string;
}

export class CancelBatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CancelLineDto extends CancelBatchDto {}

export class RenameBundleDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label: string;
}
