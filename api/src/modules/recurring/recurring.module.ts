import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { RecurringController } from './recurring.controller';
import { RecurringService } from './recurring.service';
import { RecurringScheduler } from './recurring.scheduler';

@Module({
  imports: [QueueModule],
  controllers: [RecurringController],
  providers: [RecurringService, RecurringScheduler],
  exports: [RecurringService],
})
export class RecurringModule {}
