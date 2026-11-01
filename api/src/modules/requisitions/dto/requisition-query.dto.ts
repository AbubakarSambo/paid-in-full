import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common';

export const REQUISITION_FILTERS = ['open', 'draft', 'submitted', 'cleared', 'returned', 'queued', 'rejected', 'all'] as const;
export type RequisitionFilter = (typeof REQUISITION_FILTERS)[number];

export class RequisitionQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: REQUISITION_FILTERS, default: 'open' })
  @IsOptional()
  @IsIn(REQUISITION_FILTERS as unknown as string[])
  filter?: RequisitionFilter;

  @ApiPropertyOptional({ description: 'Search vendor, item description, department' })
  @IsOptional()
  @IsString()
  search?: string;
}
