import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { QueueItemStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateQueueItemDto } from './create-queue-item.dto';

export class UpdateQueueItemDto extends PartialType(CreateQueueItemDto) {
  @ApiPropertyOptional({ enum: QueueItemStatus })
  @IsOptional()
  @IsEnum(QueueItemStatus)
  status?: QueueItemStatus;
}
