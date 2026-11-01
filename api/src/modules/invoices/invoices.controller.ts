import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceCollectionsService } from './invoice-collections.service';
import {
  ApplyCreditDto,
  ConvertQuoteDto,
  CreateInvoiceDto,
  CreateRecurrenceDto,
  DeleteInvoiceQueryDto,
  FromTemplateDto,
  InvoiceFilterDto,
  RecordPaymentDto,
  SaveAsTemplateDto,
  SendInvoiceDto,
  SimulateCollectionDto,
  UpdateInvoiceDto,
} from './dto';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';

@ApiTags('Invoices')
@ApiBearerAuth()
@RequireCapability(Capability.INVOICE)
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly collections: InvoiceCollectionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List invoices/quotes (filter by status/docType/customer/date; search number or customer)' })
  findAll(@CurrentUser('workspaceId') workspaceId: string, @Query() filter: InvoiceFilterDto) {
    return this.invoicesService.findAll(workspaceId, filter);
  }

  @Get('summary')
  @ApiOperation({ summary: 'KPIs: paid this month, outstanding, overdue' })
  summary(@CurrentUser('workspaceId') workspaceId: string) {
    return this.invoicesService.summary(workspaceId);
  }

  @Post()
  @ApiOperation({ summary: 'Create an invoice or quote (draft, or issue=true for Save & Issue); totals computed server-side' })
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.create(user, dto);
  }

  @Post('from-template/:templateId')
  @ApiOperation({ summary: 'Create a draft invoice from an invoice template' })
  fromTemplate(@Param('templateId', ParseUUIDPipe) templateId: string, @Body() dto: FromTemplateDto, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.fromTemplate(user, templateId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an invoice with items, payments, sends, sweeps, receipts and credits' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    return this.invoicesService.findOne(id, workspaceId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a draft (issue=true to Save & Issue)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceDto, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.update(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete; 409 if payments exist unless ?force=true' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Query() q: DeleteInvoiceQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.remove(user, id, q.force === 'true' || q.force === '1');
  }

  @Post(':id/issue')
  @ApiOperation({ summary: 'Issue a draft (creates the per-invoice collection account)' })
  issue(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.issue(user, id);
  }

  @Post(':id/mark-sent')
  @ApiOperation({ summary: 'Mark as sent (issues a draft first)' })
  markSent(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.markSent(user, id);
  }

  @Post(':id/void')
  @ApiOperation({ summary: 'Void an invoice or quote' })
  void(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.void(user, id);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate into a new draft with a new number' })
  duplicate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.duplicate(user, id);
  }

  @Post(':id/save-as-template')
  @ApiOperation({ summary: 'Save the invoice lines and settings as a reusable template' })
  saveAsTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveAsTemplateDto, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.saveAsTemplate(user, id, dto.name);
  }

  @Post(':id/convert')
  @ApiOperation({ summary: 'Convert a quote to an invoice (allocates a new invoice number)' })
  convert(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConvertQuoteDto, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.convertQuote(user, id, dto.issue);
  }

  @Post(':id/payments')
  @ApiOperation({ summary: 'Record a payment; overpayment becomes an open customer credit' })
  recordPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordPaymentDto, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.recordPayment(user, id, dto);
  }

  @Post(':id/apply-credit')
  @ApiOperation({ summary: "Apply one of the customer's open credits to this invoice" })
  applyCredit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyCreditDto, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.applyCredit(user, id, dto.creditId);
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Send by email (with CC) or get a WhatsApp wa.me link; records send history' })
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendInvoiceDto, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.send(user, id, dto);
  }

  @Get(':id/sends')
  @ApiOperation({ summary: 'Send history' })
  sends(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    return this.invoicesService.listSends(id, workspaceId);
  }

  @Post(':id/share-link')
  @ApiOperation({ summary: 'Get (or create) the public share link /i/:token' })
  shareLink(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.getShareLink(user, id);
  }

  @Post(':id/recurrence')
  @ApiOperation({ summary: 'Make this invoice recur (copies its lines into a recurring schedule)' })
  createRecurrence(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRecurrenceDto, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.createRecurrence(user, id, dto);
  }

  @Post(':id/collection-account')
  @ApiOperation({ summary: 'Create the dedicated Monnify collection account if missing' })
  async collectionAccount(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    await this.invoicesService.findRaw(id, workspaceId);
    await this.collections.ensureCollectionAccount(id);
    return this.invoicesService.findOne(id, workspaceId);
  }

  @Post(':id/collection/simulate')
  @ApiOperation({ summary: 'MOCK MODE ONLY: simulate a transfer into the collection account' })
  simulate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulateCollectionDto, @CurrentUser('workspaceId') workspaceId: string) {
    return this.collections.simulate(workspaceId, id, dto.amount);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download invoice/quote PDF' })
  @ApiProduces('application/pdf')
  async downloadPdf(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string, @Res() res: Response) {
    const { buffer, invoiceNumber } = await this.invoicePdfService.generateInvoicePdfById(id, workspaceId);
    sendPdf(res, buffer, invoiceNumber);
  }

  @Get(':id/receipts/:receiptId/pdf')
  @ApiOperation({ summary: 'Download a payment receipt PDF' })
  @ApiProduces('application/pdf')
  async downloadReceiptPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
    @CurrentUser('workspaceId') workspaceId: string,
    @Res() res: Response,
  ) {
    const { buffer, receiptNumber } = await this.invoicePdfService.generateReceiptPdfById(id, receiptId, workspaceId);
    sendPdf(res, buffer, receiptNumber);
  }
}

export function sendPdf(res: Response, buffer: Buffer, name: string, inline = false) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf"`,
    'Content-Length': buffer.length,
  });
  res.send(buffer);
}
