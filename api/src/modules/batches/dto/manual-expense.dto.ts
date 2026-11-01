import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';

export class LogManualExpenseDto {
  @ApiProperty({ example: '2026-10-30' })
  @IsDateString()
  date: string;

  @ApiProperty()
  @IsUUID()
  payCategoryId: string;

  @ApiProperty({ description: 'Vendor from the register' })
  @IsUUID()
  vendorId: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description: string;

  @ApiProperty()
  @IsUUID()
  coaTagId: string;

  @ApiPropertyOptional({ example: '2026-10', description: 'Activity month (defaults to the date\'s month)' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  pnlPeriod?: string;

  @ApiProperty()
  @IsUUID()
  costCenterId: string;

  @ApiProperty()
  @IsUUID()
  locationId: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  units?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  unitName?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  unitAmount: number;
}
