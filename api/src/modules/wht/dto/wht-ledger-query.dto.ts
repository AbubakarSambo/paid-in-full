import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common';

export class WhtLedgerQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter to a single tax period (first of the month), e.g. 2026-01-01' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  taxPeriod?: Date;
}
