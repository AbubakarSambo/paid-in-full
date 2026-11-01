import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Fields shared by a single requisition and a bundle header. */
export class RequisitionHeaderDto {
  @ApiPropertyOptional({ description: 'YYYY-MM-DD (defaults to today)' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Free-text department; upserted by name' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  departmentName?: string;

  @ApiPropertyOptional({ description: 'Vendor from the register (must have bank details)' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ description: 'New vendor (not yet on file)' })
  @IsOptional()
  @IsBoolean()
  isNewVendor?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  vendorName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendorBank?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendorBankCode?: string;

  @ApiPropertyOptional({ description: '10-digit NUBAN' })
  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'Account number must be 10 digits' })
  vendorAcctNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendorAcctName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiPropertyOptional({ description: 'true = submit immediately (Description Rules enforced)' })
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

export class RequisitionItemDto {
  @ApiProperty()
  @IsString()
  description: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  units?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unitName?: string;

  @ApiProperty({ minimum: 0.01 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  unitAmount: number;
}

export class CreateRequisitionDto extends RequisitionHeaderDto {
  @ApiProperty()
  @IsString()
  description: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  units?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unitName?: string;

  @ApiProperty({ minimum: 0.01 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  unitAmount: number;
}

export class CreateRequisitionBundleDto extends RequisitionHeaderDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  bundleLabel: string;

  @ApiProperty({ type: [RequisitionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequisitionItemDto)
  items: RequisitionItemDto[];
}

export class UpdateRequisitionDto extends PartialType(CreateRequisitionDto) {
  @ApiPropertyOptional({ description: 'Rename the bundle (applies to all lines in the bundle)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bundleLabel?: string;
}
