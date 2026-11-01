import { Module } from '@nestjs/common';
import { MonnifyModule } from '../monnify/monnify.module';
import { SheetsModule } from '../sheets/sheets.module';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceTemplatesService } from './invoice-templates.service';
import { InvoiceTemplatesController } from './invoice-templates.controller';
import { InvoicesCron } from './invoices.cron';
import { InvoiceConfigService } from './invoice-config.service';
import { InvoiceMonnifyClient } from './invoice-monnify.client';
import { InvoicePaymentsService } from './invoice-payments.service';
import { InvoiceCollectionsService } from './invoice-collections.service';
import { InvoiceSheetsSyncService } from './invoice-sheets-sync.service';
import { InvoiceRecurrencesService } from './invoice-recurrences.service';
import { InvoiceRecurrencesController } from './invoice-recurrences.controller';
import { InvoiceSettingsService } from './invoice-settings.service';
import { InvoiceSettingsController } from './invoice-settings.controller';
import { PublicInvoicesController } from './public-invoices.controller';

@Module({
  imports: [MonnifyModule, SheetsModule],
  controllers: [
    InvoicesController,
    InvoiceTemplatesController,
    InvoiceRecurrencesController,
    InvoiceSettingsController,
    PublicInvoicesController,
  ],
  providers: [
    InvoicesService,
    InvoicePdfService,
    InvoiceTemplatesService,
    InvoicesCron,
    InvoiceConfigService,
    InvoiceMonnifyClient,
    InvoicePaymentsService,
    InvoiceCollectionsService,
    InvoiceSheetsSyncService,
    InvoiceRecurrencesService,
    InvoiceSettingsService,
  ],
  exports: [InvoicesService, InvoicePdfService, InvoiceConfigService, InvoiceMonnifyClient, InvoiceCollectionsService],
})
export class InvoicesModule {}
