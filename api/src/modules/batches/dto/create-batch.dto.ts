import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class CreateBatchDto {
  @ApiProperty({ type: [String], description: 'QueueItem ids (must be PENDING or APPROVED_FOR_BATCH) to group into this batch' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  queueItemIds: string[];
}
