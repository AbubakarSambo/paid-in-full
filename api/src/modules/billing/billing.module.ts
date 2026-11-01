import { Module } from '@nestjs/common';
import { BillingPlansController } from './billing-plans.controller';
import { BillingPlansService } from './billing-plans.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { CustomerSubscriptionsController, PublicMandatesController } from './customer-subscriptions.controller';
import { InvoicesModule } from '../invoices/invoices.module';
import { CustomerSubscriptionsService } from './customer-subscriptions.service';
import { MonnifyModule } from '../monnify/monnify.module';

@Module({
  imports: [MonnifyModule, InvoicesModule],
  controllers: [BillingPlansController, BillingController, CustomerSubscriptionsController, PublicMandatesController],
  providers: [BillingPlansService, BillingService, CustomerSubscriptionsService],
  exports: [BillingService, BillingPlansService, CustomerSubscriptionsService],
})
export class BillingModule {}
