import { Module } from '@nestjs/common';
import { PayCategoriesService } from './pay-categories.service';
import { PayCategoriesController } from './pay-categories.controller';

@Module({
  controllers: [PayCategoriesController],
  providers: [PayCategoriesService],
  exports: [PayCategoriesService],
})
export class PayCategoriesModule {}
