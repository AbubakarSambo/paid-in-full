import { ApiPropertyOptional } from '@nestjs/swagger';
import { QueueItemStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common';

export class QueueQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: QueueItemStatus })
  @IsOptional()
  @IsEnum(QueueItemStatus)
  status?: QueueItemStatus;
}
