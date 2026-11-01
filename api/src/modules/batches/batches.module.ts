import { SheetsModule } from '../sheets/sheets.module';
import { Module } from '@nestjs/common';
import { BatchesService } from './batches.service';
import { BatchesController } from './batches.controller';
import { DisbursementService } from './disbursement.service';
import { ReceiptsService } from './receipts.service';
import { WalletModule } from '../wallet/wallet.module';
import { MonnifyModule } from '../monnify/monnify.module';

@Module({
  imports: [WalletModule, MonnifyModule, SheetsModule],
  controllers: [BatchesController],
  providers: [BatchesService, DisbursementService, ReceiptsService],
  exports: [BatchesService, DisbursementService, ReceiptsService],
})
export class BatchesModule {}
