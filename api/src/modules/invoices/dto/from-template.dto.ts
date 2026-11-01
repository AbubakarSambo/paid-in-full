import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class FromTemplateDto {
  @ApiProperty({ example: 'uuid-of-customer' })
  @IsNotEmpty()
  @IsUUID()
  customerId: string;

  @ApiPropertyOptional({ example: '2026-09-27', description: 'Defaults to today' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  issueDate?: Date;
}
