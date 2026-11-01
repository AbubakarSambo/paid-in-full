import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';
import { BatchesService } from './batches.service';
import { DisbursementService } from './disbursement.service';
import { ReceiptsService } from './receipts.service';
import {
  BatchQueryDto,
  CancelBatchDto,
  CancelLineDto,
  DisburseBatchDto,
  DisbursePreviewDto,
  LogManualExpenseDto,
  ReclassifyLineDto,
  RenameBundleDto,
  RetryLinesDto,
  SplitLineDto,
} from './dto';

/**
 * Batches (spec §5.3). Batches are created by approval in the queue module (POST /queue/approve);
 * there is no separate create or approve step here.
 */
@ApiTags('Batches')
@ApiBearerAuth()
@Controller('batches')
export class BatchesController {
  constructor(
    private readonly batches: BatchesService,
    private readonly disbursement: DisbursementService,
    private readonly receipts: ReceiptsService,
  ) {}

  private sendFile(res: Response, file: { buffer: Buffer; filename: string }, type: string) {
    res.set({
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': file.buffer.length,
    });
    res.end(file.buffer);
  }

  @Get()
  @ApiOperation({ summary: 'Batches with KPIs; paid batches returned separately' })
  list(@CurrentUser('workspaceId') workspaceId: string, @Query() query: BatchQueryDto) {
    return this.batches.list(workspaceId, query);
  }

  @Get('receipts/export.zip')
  @ApiProduces('application/zip')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async exportReceipts(
    @CurrentUser('workspaceId') workspaceId: string,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const file = await this.receipts.exportAll(workspaceId, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
    this.sendFile(res, file, 'application/zip');
  }

  @Post('manual-expense')
  @RequireCapability(Capability.APPROVE)
  @ApiOperation({ summary: 'Log manual expense (paid outside the app; wallet not affected)' })
  logManualExpense(@CurrentUser() user: CurrentUserData, @Body() dto: LogManualExpenseDto) {
    return this.batches.logManualExpense(user, dto);
  }

  @Get(':id')
  findOne(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.batches.findOne(workspaceId, id);
  }

  // ─── Money movement (payer) ───

  @Post(':id/disburse/preview')
  @RequireCapability(Capability.PAY)
  @ApiOperation({ summary: 'Validate a selection: per-line legs, total to type, ready to send, shortfall' })
  previewDisburse(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisbursePreviewDto) {
    return this.disbursement.preview(workspaceId, id, dto);
  }

  @Post(':id/disburse')
  @RequireCapability(Capability.PAY)
  @ApiOperation({ summary: 'Disburse selected lines (PIN + typed total). Retrying with the same clientRequestId recovers.' })
  disburse(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisburseBatchDto) {
    return this.disbursement.disburse(user, id, dto);
  }

  @Get(':id/disbursements/:clientRequestId')
  @ApiOperation({ summary: 'True outcome of a (possibly interrupted) disburse request, from the payout ledger' })
  disbursementResult(
    @CurrentUser('workspaceId') workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('clientRequestId', ParseUUIDPipe) clientRequestId: string,
  ) {
    return this.disbursement.getRequestResult(workspaceId, id, clientRequestId);
  }

  @Post(':id/check-status')
  @RequireCapability(Capability.PAY)
  @ApiOperation({ summary: 'Re-query Monnify for in-flight transfers' })
  async checkStatus(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.disbursement.checkStatus(workspaceId, id);
    return { ...result, batch: await this.batches.findOne(workspaceId, id) };
  }

  @Post(':id/retry')
  @RequireCapability(Capability.PAY)
  @ApiOperation({ summary: 'Reset failed lines for the next disbursement (omit itemIds for Retry all)' })
  retry(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RetryLinesDto) {
    return this.disbursement.retry(user, id, dto.itemIds);
  }

  // ─── Batch actions ───

  @Post(':id/cancel')
  @RequireCapability(Capability.APPROVE)
  cancel(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelBatchDto) {
    return this.batches.cancelBatch(user, id, dto);
  }

  @Delete(':id')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Delete an untouched batch (no payout attempt ever); nothing returns to the queue' })
  remove(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.batches.deleteUntouched(user, id);
  }

  @Patch(':id/bundles/:bundleKey')
  @RequireCapability(Capability.APPROVE)
  renameBundle(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bundleKey') bundleKey: string,
    @Body() dto: RenameBundleDto,
  ) {
    return this.batches.renameBundle(user, id, decodeURIComponent(bundleKey), dto);
  }

  // ─── Receipts ───

  @Get(':id/receipt.pdf')
  @ApiProduces('application/pdf')
  async batchReceipt(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    this.sendFile(res, await this.receipts.batchReceipt(workspaceId, id), 'application/pdf');
  }

  @Get(':id/receipts.zip')
  @ApiProduces('application/zip')
  async batchZip(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    this.sendFile(res, await this.receipts.batchZip(workspaceId, id), 'application/zip');
  }

  @Get(':id/bundles/:bundleKey/receipt.pdf')
  @ApiProduces('application/pdf')
  async bundleReceipt(
    @CurrentUser('workspaceId') workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bundleKey') bundleKey: string,
    @Res() res: Response,
  ) {
    this.sendFile(res, await this.receipts.bundleReceipt(workspaceId, id, decodeURIComponent(bundleKey)), 'application/pdf');
  }

  @Get(':id/items/:itemId/receipt.pdf')
  @ApiProduces('application/pdf')
  async lineReceipt(
    @CurrentUser('workspaceId') workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Res() res: Response,
  ) {
    this.sendFile(res, await this.receipts.lineReceipt(workspaceId, id, itemId), 'application/pdf');
  }

  @Get(':id/items/:itemId/whatsapp')
  whatsapp(
    @CurrentUser('workspaceId') workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.receipts.whatsappLink(workspaceId, id, itemId);
  }

  // ─── Line actions (approver) ───

  @Post(':id/items/:itemId/cancel')
  @RequireCapability(Capability.APPROVE)
  cancelLine(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: CancelLineDto,
  ) {
    return this.batches.cancelLine(user, id, itemId, dto);
  }

  @Post(':id/items/:itemId/return')
  @RequireCapability(Capability.APPROVE)
  returnLine(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.batches.returnLine(user, id, itemId);
  }

  @Post(':id/items/:itemId/split')
  @RequireCapability(Capability.APPROVE)
  splitLine(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: SplitLineDto,
  ) {
    return this.batches.splitLine(user, id, itemId, dto);
  }

  @Patch(':id/items/:itemId')
  @RequireCapability(Capability.APPROVE)
  @ApiOperation({ summary: 'Reclassify a line (BU, BU head, COA, period, vendor, description)' })
  reclassify(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: ReclassifyLineDto,
  ) {
    return this.batches.reclassifyLine(user, id, itemId, dto);
  }
}
