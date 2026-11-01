import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { RequisitionsService } from './requisitions.service';
import { RequisitionsController } from './requisitions.controller';

@Module({
  imports: [QueueModule],
  controllers: [RequisitionsController],
  providers: [RequisitionsService],
  exports: [RequisitionsService],
})
export class RequisitionsModule {}
