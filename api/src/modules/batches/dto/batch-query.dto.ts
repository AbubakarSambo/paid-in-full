import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const BATCH_FILTERS = ['all', 'ready', 'paid', 'PENDING', 'PROCESSING', 'PARTIAL', 'SUCCESS', 'CANCELLED'] as const;

export class BatchQueryDto {
  @ApiPropertyOptional({ description: 'Text filter: batch ref, vendor, category or status' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: BATCH_FILTERS, default: 'all' })
  @IsOptional()
  @IsIn(BATCH_FILTERS as unknown as string[])
  status?: (typeof BATCH_FILTERS)[number];
}
