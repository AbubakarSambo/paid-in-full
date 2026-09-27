import { Module } from '@nestjs/common';
import { WhtService } from './wht.service';
import { WhtController } from './wht.controller';

@Module({
  controllers: [WhtController],
  providers: [WhtService],
  exports: [WhtService],
})
export class WhtModule {}
