import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateRecurringPaymentDto {
  @ApiProperty()
  @IsUUID()
  vendorId: string;

  @ApiProperty({ description: 'The due date (DD/MM/YYYY) is appended automatically when queued' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description: string;

  @ApiProperty({ minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ minimum: 1, maximum: 31, description: '29–31 clamp to the last day of shorter months' })
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth: number;

  @ApiPropertyOptional({ default: 2, minimum: 0, maximum: 27, description: 'Mark urgent this many days before the due day' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(27)
  urgentDays?: number;

  @ApiProperty()
  @IsUUID()
  payCategoryId: string;

  @ApiProperty()
  @IsUUID()
  coaTagId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
