import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CoaTagsController } from './coa-tags.controller';
import { CoaTagsService } from './coa-tags.service';

@Module({
  imports: [AiModule],
  controllers: [CoaTagsController],
  providers: [CoaTagsService],
  exports: [CoaTagsService],
})
export class CoaTagsModule {}
