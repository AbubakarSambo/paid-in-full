import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { InvoiceStatus } from '@prisma/client';
import { PaginationDto } from '../../../common';

export class InvoiceFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: InvoiceStatus, description: 'SENT also matches PARTIALLY_PAID' })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ enum: ['INVOICE', 'QUOTE'] })
  @IsOptional()
  @IsIn(['INVOICE', 'QUOTE'])
  docType?: 'INVOICE' | 'QUOTE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Search invoice/quote number or customer name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by issueDate >= startDate' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @ApiPropertyOptional({ description: 'Filter by issueDate <= endDate' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;
}
