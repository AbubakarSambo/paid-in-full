import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { sendPdf } from './invoices.controller';

/** Public invoice/quote view for /i/:token (no auth; the unguessable share token is the key). */
@ApiTags('Public')
@Public()
@Controller('public/invoices')
export class PublicInvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly pdf: InvoicePdfService,
  ) {}

  @Get(':token')
  @Throttle({ global: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: 'Public invoice/quote payload: bill-to, items, totals, less WHT, paid, balance, bank details, branding' })
  view(@Param('token') token: string) {
    return this.invoices.getPublicView(token);
  }

  @Get(':token/pdf')
  @Throttle({ global: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Public invoice/quote PDF' })
  @ApiProduces('application/pdf')
  async downloadPdf(@Param('token') token: string, @Res() res: Response) {
    const inv = await this.invoices.findIdByShareToken(token);
    const { buffer, invoiceNumber } = await this.pdf.generateInvoicePdfById(inv.id, inv.workspaceId);
    sendPdf(res, buffer, invoiceNumber, true);
  }
}
