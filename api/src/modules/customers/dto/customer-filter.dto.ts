import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common';

export class CustomerFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Search by name, email, phone or TIN' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['active', 'archived', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'archived', 'all'])
  status?: 'active' | 'archived' | 'all';
}

export class MergeCustomerDto {
  @ApiPropertyOptional({ description: 'Duplicate customer to merge INTO the customer in the URL (it is archived afterwards)' })
  @IsUUID()
  mergeId: string;
}

export class CreditFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'APPLIED', 'REFUNDED'] })
  @IsOptional()
  @IsIn(['OPEN', 'APPLIED', 'REFUNDED'])
  status?: 'OPEN' | 'APPLIED' | 'REFUNDED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;
}
