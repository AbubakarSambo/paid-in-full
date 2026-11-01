import { Module } from '@nestjs/common';
import { MonnifyModule } from '../monnify/monnify.module';
import { WhtService } from './wht.service';
import { WhtController } from './wht.controller';

@Module({
  imports: [MonnifyModule],
  controllers: [WhtController],
  providers: [WhtService],
  exports: [WhtService],
})
export class WhtModule {}
