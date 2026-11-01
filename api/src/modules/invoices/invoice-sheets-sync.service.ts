import { Injectable, Logger } from '@nestjs/common';
import { SheetsService } from '../sheets/sheets.service';

/**
 * Upserts the invoice into the Google Sheets INVOICES tab (spec §5.8) after every invoice change.
 * Fire-and-forget: a missing configuration or a failing sync never fails an invoice request.
 */
@Injectable()
export class InvoiceSheetsSyncService {
  private readonly logger = new Logger(InvoiceSheetsSyncService.name);

  constructor(private readonly sheets: SheetsService) {}

  sync(workspaceId: string, invoiceId: string): void {
    Promise.resolve()
      .then(() => this.sheets.syncInvoice(workspaceId, invoiceId))
      .catch((err) => this.logger.warn(`Sheets sync for invoice ${invoiceId} failed: ${(err as Error)?.message}`));
  }
}
