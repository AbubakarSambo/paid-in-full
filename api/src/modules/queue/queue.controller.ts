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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';
import {
  AddBundleItemsDto,
  AddCommentDto,
  ApproveQueueItemsDto,
  BudgetCheckDto,
  BulkCreateQueueDto,
  BundleUrgentDto,
  CreateBundleDto,
  CreateQueueItemDto,
  CsvTextDto,
  QueueQueryDto,
  RejectQueueItemDto,
  RenameBundleDto,
  SplitQueueItemDto,
  UpdateQueueItemDto,
} from './dto';
import { QueueService } from './queue.service';
import { QueueApprovalService } from './queue-approval.service';
import { ATTACHMENT_UPLOAD_OPTIONS, QueueAttachmentsService, UploadedFileLike } from './queue-attachments.service';

@ApiTags('Queue')
@ApiBearerAuth()
@Controller('queue')
export class QueueController {
  constructor(
    private readonly queueService: QueueService,
    private readonly approval: QueueApprovalService,
    private readonly attachments: QueueAttachmentsService,
  ) {}

  // ─── Read (static routes first, before :id) ────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Pending queue grouped into category lanes, with toolbar counts' })
  lanes(@CurrentUser('workspaceId') workspaceId: string, @Query() query: QueueQueryDto) {
    return this.queueService.lanes(workspaceId, query);
  }

  @Get('rejected')
  rejected(@CurrentUser('workspaceId') workspaceId: string, @Query() query: QueueQueryDto) {
    return this.queueService.listRejected(workspaceId, query);
  }

  @Get('csv/template')
  async csvTemplate(@CurrentUser('workspaceId') workspaceId: string, @Res() res: Response) {
    const csv = await this.queueService.csvTemplate(workspaceId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="queue-template.csv"');
    res.send(csv);
  }

  @Get('attachments/:attachmentId/download')
  download(
    @CurrentUser('workspaceId') workspaceId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res() res: Response,
  ) {
    return this.attachments.download(workspaceId, attachmentId, res);
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  @Post()
  @RequireCapability(Capability.POST)
  @ApiOperation({ summary: 'Add a queue item (409 DUPLICATE_WARNING unless confirmDuplicate)' })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateQueueItemDto) {
    return this.queueService.create(user, dto);
  }

  @Post('bulk')
  @RequireCapability(Capability.POST)
  @ApiOperation({ summary: 'Quick-add grid save (all rows or none)' })
  bulk(@CurrentUser() user: CurrentUserData, @Body() dto: BulkCreateQueueDto) {
    return this.queueService.bulkCreate(user, dto);
  }

  @Post('csv/preview')
  @RequireCapability(Capability.POST)
  csvPreview(@CurrentUser() user: CurrentUserData, @Body() dto: CsvTextDto) {
    return this.queueService.csvPreview(user, dto);
  }

  @Post('csv/import')
  @RequireCapability(Capability.POST)
  csvImport(@CurrentUser() user: CurrentUserData, @Body() dto: CsvTextDto) {
    return this.queueService.csvImport(user, dto);
  }

  // ─── Approve → batch ──────────────────────────────────────────────────────

  @Post('approve/budget-check')
  @RequireCapability(Capability.APPROVE)
  @ApiOperation({ summary: 'Per-COA budget projections for a selection (Tag, Cap, Spent, +This, Projected, Over by)' })
  budgetCheck(@CurrentUser() user: CurrentUserData, @Body() dto: BudgetCheckDto) {
    return this.approval.budgetCheck(user.workspaceId, dto);
  }

  @Post('approve/budget-cancel')
  @RequireCapability(Capability.APPROVE)
  @ApiOperation({ summary: 'Audit that the approver cancelled at the budget warning' })
  budgetCancel(@CurrentUser() user: CurrentUserData, @Body() dto: BudgetCheckDto) {
    return this.approval.recordBudgetCancel(user, dto);
  }

  @Post('approve')
  @RequireCapability(Capability.APPROVE)
  @ApiOperation({ summary: 'approve_queue_items: one batch per category, idempotent' })
  approve(@CurrentUser() user: CurrentUserData, @Body() dto: ApproveQueueItemsDto) {
    return this.approval.approve(user, dto);
  }

  // ─── Bundles ──────────────────────────────────────────────────────────────

  @Post('bundles')
  @RequireCapability(Capability.POST)
  createBundle(@CurrentUser() user: CurrentUserData, @Body() dto: CreateBundleDto) {
    return this.queueService.createBundle(user, dto);
  }

  @Post('bundles/:bundleId/items')
  @RequireCapability(Capability.POST)
  addBundleItems(
    @CurrentUser() user: CurrentUserData,
    @Param('bundleId', ParseUUIDPipe) bundleId: string,
    @Body() dto: AddBundleItemsDto,
  ) {
    return this.queueService.addBundleItems(user, bundleId, dto);
  }

  @Patch('bundles/:bundleId')
  @RequireCapability(Capability.POST)
  renameBundle(
    @CurrentUser() user: CurrentUserData,
    @Param('bundleId', ParseUUIDPipe) bundleId: string,
    @Body() dto: RenameBundleDto,
  ) {
    return this.queueService.renameBundle(user, bundleId, dto.bundleLabel);
  }

  @Patch('bundles/:bundleId/urgent')
  @RequireCapability(Capability.POST)
  bundleUrgent(
    @CurrentUser() user: CurrentUserData,
    @Param('bundleId', ParseUUIDPipe) bundleId: string,
    @Body() dto: BundleUrgentDto,
  ) {
    return this.queueService.setBundleUrgent(user, bundleId, dto.isUrgent);
  }

  @Delete('bundles/:bundleId')
  @RequireCapability(Capability.POST)
  deleteBundle(@CurrentUser() user: CurrentUserData, @Param('bundleId', ParseUUIDPipe) bundleId: string) {
    return this.queueService.deleteBundle(user, bundleId);
  }

  @Delete('attachments/:attachmentId')
  @RequireCapability(Capability.POST)
  removeAttachment(
    @CurrentUser('workspaceId') workspaceId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.attachments.remove(workspaceId, attachmentId);
  }

  // ─── Single item ──────────────────────────────────────────────────────────

  @Get(':id')
  findOne(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.queueService.findOne(workspaceId, id);
  }

  @Patch(':id')
  @RequireCapability(Capability.POST)
  @ApiOperation({ summary: 'Edit; an amount change needs amountChangeReason (audited old/new)' })
  update(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQueueItemDto) {
    return this.queueService.update(user, id, dto);
  }

  @Delete(':id')
  @RequireCapability(Capability.POST)
  @ApiOperation({ summary: 'Hard delete (genuine mistakes only)' })
  remove(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.queueService.remove(user, id);
  }

  @Post(':id/split')
  @RequireCapability(Capability.APPROVE)
  split(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SplitQueueItemDto) {
    return this.queueService.split(user, id, dto);
  }

  @Post(':id/reject')
  @RequireCapability(Capability.APPROVE)
  reject(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectQueueItemDto) {
    return this.queueService.reject(user, id, dto);
  }

  @Post(':id/restore')
  @RequireCapability(Capability.APPROVE)
  restore(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.queueService.restore(user, id);
  }

  @Get(':id/attachments')
  async listAttachments(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    const item = await this.queueService.findOne(workspaceId, id);
    return item.attachments;
  }

  @Post(':id/attachments')
  @RequireCapability(Capability.POST)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', ATTACHMENT_UPLOAD_OPTIONS))
  async upload(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    this.attachments.validate(file);
    const attachmentGroupId = await this.queueService.ensureAttachmentGroup(user.workspaceId, id);
    return this.attachments.upload(user.workspaceId, user.id, file, { attachmentGroupId, queueItemId: id });
  }

  @Get(':id/comments')
  listComments(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.queueService.listComments(workspaceId, id);
  }

  @Post(':id/comments')
  @RequireCapability(Capability.POST)
  addComment(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddCommentDto) {
    return this.queueService.addComment(user, id, dto);
  }
}
