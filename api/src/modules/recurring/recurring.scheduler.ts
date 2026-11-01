import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecurringService } from './recurring.service';

/**
 * Daily run of spec run_recurring_payments(). Safe to overlap with a manual run: enqueueing is
 * idempotent per payment per period. (On serverless hosts without a long-lived process, trigger
 * POST /recurring/run from an external cron instead.)
 */
@Injectable()
export class RecurringScheduler {
  private readonly logger = new Logger(RecurringScheduler.name);

  constructor(private readonly recurring: RecurringService) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM, { name: 'recurring-payments' })
  async handleDaily() {
    try {
      const r = await this.recurring.runAll();
      this.logger.log(
        `Recurring payments: ${r.queued} queued, ${r.skippedNoBank} skipped (no bank) across ${r.workspaces} workspace(s); ${r.errors} error(s)`,
      );
    } catch (error) {
      this.logger.error('Recurring payments job failed', error as Error);
    }
  }
}
