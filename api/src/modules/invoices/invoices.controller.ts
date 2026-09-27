import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import {
  CreateInvoiceDto,
  UpdateInvoiceDto,
  InvoiceFilterDto,
  RecordPaymentDto,
  SendInvoiceDto,
  CreateRecurrenceDto,
  CreateSweepDto,
  FromTemplateDto,
} from './dto';
import { CurrentUser, CurrentUserData, Role, Roles } from '../../common';

@ApiTags('Invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List invoices (paginated, filter by status/customer/date range)' })
  findAll(@CurrentUser('workspaceId') workspaceId: string, @Query() filter: InvoiceFilterDto) {
    return this.invoicesService.findAll(workspaceId, filter);
  }

  @Post('from-template/:templateId')
  @ApiOperation({ summary: 'Create a draft invoice from an invoice template' })
  fromTemplate(
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() dto: FromTemplateDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.invoicesService.fromTemplate(templateId, workspaceId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get invoice by id, with items/payments/sends/sweeps/receipts' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    return this.invoicesService.findOne(id, workspaceId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft invoice with line items' })
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.create(user.workspaceId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a draft invoice' })
  @ApiResponse({ status: 400, description: 'Only draft invoices can be edited' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.invoicesService.update(id, workspaceId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a draft invoice' })
  @ApiResponse({ status: 400, description: 'Only draft invoices can be deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    return this.invoicesService.remove(id, workspaceId);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download invoice as PDF' })
  @ApiProduces('application/pdf')
  async downloadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('workspaceId') workspaceId: string,
    @Res() res: Response,
  ) {
    const { buffer, invoiceNumber } = await this.invoicePdfService.generateInvoicePdfById(id, workspaceId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoiceNumber}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  @Post(':id/payments')
  @ApiOperation({ summary: 'Record a payment against an invoice; auto-creates a payment receipt' })
  recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.invoicesService.recordPayment(id, workspaceId, dto);
  }

  @Get(':id/receipts/:receiptId/pdf')
  @ApiOperation({ summary: 'Download a payment receipt as PDF' })
  @ApiProduces('application/pdf')
  async downloadReceiptPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
    @CurrentUser('workspaceId') workspaceId: string,
    @Res() res: Response,
  ) {
    const { buffer, receiptNumber } = await this.invoicePdfService.generateReceiptPdfById(
      id,
      receiptId,
      workspaceId,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${receiptNumber}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Send a draft invoice to the customer (records the send + flips to SENT)' })
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendInvoiceDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.invoicesService.send(id, workspaceId, dto);
  }

  @Post(':id/recurrence')
  @ApiOperation({ summary: 'Configure recurring invoice generation from this invoice' })
  createRecurrence(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRecurrenceDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.invoicesService.createRecurrence(id, workspaceId, dto);
  }

  @Post(':id/sweep')
  @Roles(Role.ADMIN, Role.APPROVER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Manually reconcile a matched bank-sheet row against this invoice' })
  createSweep(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSweepDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.invoicesService.createSweep(id, workspaceId, dto);
  }
}
