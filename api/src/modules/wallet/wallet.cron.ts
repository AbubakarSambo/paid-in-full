import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MonnifyService } from '../monnify/monnify.service';
import { WalletService } from './wallet.service';

/**
 * Money-in background jobs (single API replica, so no distributed lock is needed). They mirror Lovable's
 * pg_cron monnify-poll and monnify-sweep jobs; payout recovery lives in DisbursementService.
 */
@Injectable()
export class WalletCron {
  constructor(
    private readonly wallet: WalletService,
    @Inject(forwardRef(() => MonnifyService)) private readonly monnify: MonnifyService,
  ) {}

  /** monnify-poll, every 5 minutes: wallet top-ups, then invoice collection accounts and billing accounts. */
  @Cron('*/5 * * * *', { name: 'monnify-poll' })
  async poll() {
    return { wallet: await this.wallet.pollAllTopups(), collections: await this.monnify.pollCollectionAccounts() };
  }

  /** monnify-sweep, every 10 minutes. */
  @Cron('*/10 * * * *', { name: 'monnify-sweep' })
  sweep() {
    return this.wallet.runSweep();
  }
}
