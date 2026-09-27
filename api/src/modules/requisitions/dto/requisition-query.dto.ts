import { ApiPropertyOptional } from '@nestjs/swagger';
import { RequisitionStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common';

export class RequisitionQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: RequisitionStatus })
  @IsOptional()
  @IsEnum(RequisitionStatus)
  status?: RequisitionStatus;
}
