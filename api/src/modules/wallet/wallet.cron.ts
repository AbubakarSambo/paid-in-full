import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WalletService } from './wallet.service';

/** Wallet background jobs (single API replica, so no distributed lock is needed). */
@Injectable()
export class WalletCron {
  constructor(private readonly wallet: WalletService) {}

  /** Lovable monnify-poll: every 5 minutes. */
  @Cron('*/5 * * * *', { name: 'monnify-poll' })
  poll() {
    return this.wallet.pollAllTopups();
  }

  /** Funding-wait half of Lovable monnify-sweep: every 10 minutes. */
  @Cron('*/10 * * * *', { name: 'funding-waits' })
  fundingWaits() {
    return this.wallet.resolveFundingWaits();
  }
}
