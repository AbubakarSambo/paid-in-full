import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserData } from '../../common';
import {
  AddAttachmentDto,
  AddCommentDto,
  CreateQueueItemDto,
  CsvImportDto,
  QueueQueryDto,
  UpdateQueueItemDto,
} from './dto';
import { QueueService } from './queue.service';

@ApiTags('Queue')
@ApiBearerAuth()
@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get()
  list(@CurrentUser('workspaceId') workspaceId: string, @Query() query: QueueQueryDto) {
    return this.queueService.list(workspaceId, query);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateQueueItemDto) {
    return this.queueService.create(user.workspaceId, user.id, dto);
  }

  @Post('csv-import')
  importCsv(@CurrentUser() user: CurrentUserData, @Body() dto: CsvImportDto) {
    return this.queueService.importCsv(user.workspaceId, user.id, dto);
  }

  @Get(':id')
  findOne(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.queueService.findOne(workspaceId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser('workspaceId') workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQueueItemDto,
  ) {
    return this.queueService.update(workspaceId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.queueService.remove(workspaceId, id);
  }

  @Post(':id/attachments')
  addAttachment(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddAttachmentDto,
  ) {
    return this.queueService.addAttachment(user.workspaceId, id, user.id, dto);
  }

  @Post(':id/comments')
  addComment(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCommentDto,
  ) {
    return this.queueService.addComment(user.workspaceId, id, user.id, dto);
  }

  @Get(':id/comments')
  listComments(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.queueService.listComments(workspaceId, id);
  }
}
