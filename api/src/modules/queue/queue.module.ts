import { SheetsModule } from '../sheets/sheets.module';
import { Module } from '@nestjs/common';
import { WhtModule } from '../wht/wht.module';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { QueueLineBuilder, NotifyBridge } from './queue-core';
import { QueueApprovalService } from './queue-approval.service';
import { QueueAttachmentsService } from './queue-attachments.service';

@Module({
  imports: [WhtModule, SheetsModule],
  controllers: [QueueController],
  providers: [QueueService, QueueLineBuilder, NotifyBridge, QueueApprovalService, QueueAttachmentsService],
  exports: [QueueService, QueueLineBuilder, NotifyBridge, QueueApprovalService, QueueAttachmentsService],
})
export class QueueModule {}
