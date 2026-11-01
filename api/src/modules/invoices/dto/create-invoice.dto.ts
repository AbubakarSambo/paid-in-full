import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { InvoiceItemDto } from './invoice-item.dto';

export class CreateInvoiceDto {
  @ApiPropertyOptional({ enum: ['INVOICE', 'QUOTE'], default: 'INVOICE' })
  @IsOptional()
  @IsIn(['INVOICE', 'QUOTE'])
  docType?: 'INVOICE' | 'QUOTE';

  @ApiPropertyOptional({ description: 'Save & issue (true) or save as draft (false, default)' })
  @IsOptional()
  @IsBoolean()
  issue?: boolean;

  @ApiProperty({ example: 'uuid-of-customer' })
  @IsNotEmpty()
  @IsUUID()
  customerId: string;

  @ApiPropertyOptional({ description: 'Billing address; defaults to the customer address' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerAddress?: string;

  @ApiPropertyOptional({ example: '2026-09-27', description: 'Defaults to today' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  issueDate?: Date;

  @ApiPropertyOptional({ example: '2026-10-11', description: 'Explicit due date (wins over dueDays)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;

  @ApiPropertyOptional({ example: 14, description: 'Due in N days from the issue date (default 14)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  dueDays?: number;

  @ApiPropertyOptional({ description: 'Quotes: expiry date (default issue date + 30 days)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  quoteExpiresAt?: Date;

  @ApiPropertyOptional({ example: 'NGN' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ example: 1550.25, description: 'FX rate to the base currency' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fxRate?: number;

  @ApiPropertyOptional({ example: 'NGN' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  fxBaseCurrency?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  taxInclusive?: boolean;

  @ApiProperty({ type: [InvoiceItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];

  @ApiPropertyOptional({ enum: ['PERCENT', 'FLAT'], nullable: true })
  @IsOptional()
  @IsIn(['PERCENT', 'FLAT', null])
  discountType?: 'PERCENT' | 'FLAT' | null;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional({ description: 'Defaults to the workspace TIN' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  workspaceTin?: string;

  @ApiPropertyOptional({ description: 'Defaults to the customer tax ID' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerTin?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  lateFeePercent?: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  lateFeeFlat?: number;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @IsInt()
  @Min(0)
  lateFeeGraceDays?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  earlyPayDiscountPercent?: number;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @IsInt()
  @Min(0)
  earlyPayDiscountDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Defaults to "Payment due within 14 days…"' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  terms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  templateId?: string;
}
