import { Module } from '@nestjs/common';
import { BatchesService } from './batches.service';
import { BatchesController } from './batches.controller';
import { WalletModule } from '../wallet/wallet.module';
import { MonnifyModule } from '../monnify/monnify.module';
import { WhtModule } from '../wht/wht.module';

@Module({
  imports: [WalletModule, MonnifyModule, WhtModule],
  controllers: [BatchesController],
  providers: [BatchesService],
  exports: [BatchesService],
})
export class BatchesModule {}
