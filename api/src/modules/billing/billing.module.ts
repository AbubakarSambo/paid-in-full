import { Module } from '@nestjs/common';
import { BillingPlansController } from './billing-plans.controller';
import { BillingPlansService } from './billing-plans.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { CustomerSubscriptionsController } from './customer-subscriptions.controller';
import { CustomerSubscriptionsService } from './customer-subscriptions.service';

@Module({
  controllers: [BillingPlansController, BillingController, CustomerSubscriptionsController],
  providers: [BillingPlansService, BillingService, CustomerSubscriptionsService],
  exports: [BillingService, BillingPlansService, CustomerSubscriptionsService],
})
export class BillingModule {}
