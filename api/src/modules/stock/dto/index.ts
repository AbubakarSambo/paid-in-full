import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreateStockExpenseDto {
  @ApiProperty({ example: 'Diesel per litre' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ description: 'Default line description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  payCategoryId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  coaTagId?: string | null;

  @ApiPropertyOptional({ description: 'Default vendor' })
  @IsOptional()
  @IsUUID()
  vendorId?: string | null;

  @ApiPropertyOptional({ example: 'litre' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  unitName?: string;

  @ApiPropertyOptional({ description: 'Default unit price (NGN)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateStockExpenseDto extends PartialType(CreateStockExpenseDto) {}

export class StockQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'true = active only (the picker); omit = all' })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === true || value === 'true'))
  @IsBoolean()
  active?: boolean;
}

export class ImportStockCsvDto {
  @ApiProperty({ description: 'CSV: name,description,category,coa,vendor,unit_name,unit_price,active' })
  @IsString()
  @MinLength(1)
  @MaxLength(2_000_000)
  csv: string;
}
