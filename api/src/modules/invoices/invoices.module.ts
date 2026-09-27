import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceTemplatesService } from './invoice-templates.service';
import { InvoiceTemplatesController } from './invoice-templates.controller';
import { InvoicesCron } from './invoices.cron';

@Module({
  controllers: [InvoicesController, InvoiceTemplatesController],
  providers: [InvoicesService, InvoicePdfService, InvoiceTemplatesService, InvoicesCron],
  exports: [InvoicesService, InvoicePdfService],
})
export class InvoicesModule {}
