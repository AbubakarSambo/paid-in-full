import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { RecurrenceInterval } from '@prisma/client';
import { InvoiceItemDto } from './invoice-item.dto';

/** Accepts the spec's lower-case cadence names; "yearly" maps to ANNUALLY. */
export const toInterval = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const v = value.trim().toUpperCase();
  return v === 'YEARLY' ? 'ANNUALLY' : v;
};

/** From an existing invoice: POST /invoices/:id/recurrence */
export class CreateRecurrenceDto {
  @ApiProperty({ enum: [...Object.values(RecurrenceInterval), 'YEARLY'] })
  @IsNotEmpty()
  @Transform(toInterval)
  @IsEnum(RecurrenceInterval)
  interval: RecurrenceInterval;

  @ApiPropertyOptional({ description: 'First run; defaults to one cadence after the invoice issue date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  nextRunAt?: Date;

  @ApiPropertyOptional({ description: 'Stop generating new invoices after this date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endsAt?: Date;

  @ApiPropertyOptional({ default: 14 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  dueDays?: number;
}

/** Stand-alone recurring schedule: POST /invoice-recurrences */
export class CreateInvoiceRecurrenceDto {
  @ApiProperty()
  @IsUUID()
  customerId: string;

  @ApiProperty({ enum: [...Object.values(RecurrenceInterval), 'YEARLY'] })
  @Transform(toInterval)
  @IsEnum(RecurrenceInterval)
  interval: RecurrenceInterval;

  @ApiProperty({ description: 'Next run date' })
  @Type(() => Date)
  @IsDate()
  nextRunAt: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endsAt?: Date;

  @ApiPropertyOptional({ default: 14 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  dueDays?: number;

  @ApiPropertyOptional({ default: 'NGN' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  terms?: string;

  @ApiProperty({ type: [InvoiceItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateInvoiceRecurrenceDto extends PartialType(CreateInvoiceRecurrenceDto) {}
