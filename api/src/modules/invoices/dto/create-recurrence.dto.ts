import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { RecurrenceInterval } from '@prisma/client';

export class CreateRecurrenceDto {
  @ApiProperty({ enum: RecurrenceInterval })
  @IsNotEmpty()
  @IsEnum(RecurrenceInterval)
  interval: RecurrenceInterval;

  @ApiPropertyOptional({ description: 'Stop generating new invoices after this date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endsAt?: Date;
}
