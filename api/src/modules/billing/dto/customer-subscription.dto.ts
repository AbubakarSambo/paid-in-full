import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { RecurrenceInterval } from '@prisma/client';
import { PaginationDto } from '../../../common';

const toInterval = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const v = value.trim().toUpperCase();
  return v === 'YEARLY' ? 'ANNUALLY' : v;
};

/** Settings §18 Client Subscriptions: a plan the workspace charges its own client. */
export class CreateCustomerSubscriptionDto {
  @ApiProperty()
  @IsUUID()
  customerId: string;

  @ApiProperty({ example: 'Gold retainer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  planName: string;

  @ApiProperty({ example: 150000 })
  @IsNumber()
  @Min(100)
  amount: number;

  @ApiProperty({ enum: [...Object.values(RecurrenceInterval), 'YEARLY'], description: 'Frequency (yearly = ANNUALLY)' })
  @Transform(toInterval)
  @IsEnum(RecurrenceInterval)
  interval: RecurrenceInterval;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'First charge date (default: when the mandate is authorised)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;
}

export class UpdateCustomerSubscriptionDto extends PartialType(CreateCustomerSubscriptionDto) {}

export class SubscriptionFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['PENDING_MANDATE', 'ACTIVE', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['PENDING_MANDATE', 'ACTIVE', 'CANCELLED'])
  status?: 'PENDING_MANDATE' | 'ACTIVE' | 'CANCELLED';
}

export class ChargeNowDto {
  @ApiPropertyOptional({ example: 150000, description: 'Defaults to the plan amount' })
  @IsOptional()
  @IsNumber()
  @Min(100)
  amount?: number;

  @ApiPropertyOptional({ description: 'Idempotency key' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientRequestId?: string;
}

/** Public /m/:token authorisation. */
export class AuthoriseMandateDto {
  @ApiProperty({ enum: ['CARD', 'DIRECT_DEBIT'] })
  @IsIn(['CARD', 'DIRECT_DEBIT'])
  method: 'CARD' | 'DIRECT_DEBIT';

  @ApiPropertyOptional({ description: 'Card: where Monnify redirects after checkout' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  redirectUrl?: string;

  @ApiPropertyOptional({ description: 'Card: payer email if the customer has none on file' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '058' })
  @ValidateIf((o) => o.method === 'DIRECT_DEBIT')
  @Matches(/^\d{3,6}$/, { message: 'Select a bank' })
  bankCode?: string;

  @ApiPropertyOptional({ example: '0123456789' })
  @ValidateIf((o) => o.method === 'DIRECT_DEBIT')
  @Matches(/^\d{10}$/, { message: 'Account number must be a 10-digit NUBAN' })
  accountNumber?: string;

  @ApiPropertyOptional({ example: '08012345678' })
  @ValidateIf((o) => o.method === 'DIRECT_DEBIT')
  @Matches(/^\d{11}$/, { message: 'Phone number must be 11 digits' })
  phone?: string;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.method === 'DIRECT_DEBIT')
  @IsString()
  @IsNotEmpty({ message: 'Address is required' })
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountName?: string;
}
