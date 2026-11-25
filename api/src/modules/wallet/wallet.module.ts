import { Module, forwardRef } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { PayoutLedgerService } from './payout-ledger.service';
import { WalletCron } from './wallet.cron';
import { MonnifyModule } from '../monnify/monnify.module';

@Module({
  imports: [forwardRef(() => MonnifyModule)],
  controllers: [WalletController],
  providers: [WalletService, PayoutLedgerService, WalletCron],
  exports: [WalletService, PayoutLedgerService],
})
export class WalletModule {}
