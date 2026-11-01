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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserData, Capability, RequireCapability } from '../../common';
import { ATTACHMENT_UPLOAD_OPTIONS, UploadedFileLike } from '../queue/queue-attachments.service';
import {
  CreateRequisitionBundleDto,
  CreateRequisitionDto,
  PushToQueueDto,
  RequisitionQueryDto,
  ReviewRequisitionDto,
  UpdateRequisitionDto,
} from './dto';
import { RequisitionsService } from './requisitions.service';

@ApiTags('Requisitions')
@ApiBearerAuth()
@Controller('requisitions')
export class RequisitionsController {
  constructor(private readonly requisitionsService: RequisitionsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserData, @Query() query: RequisitionQueryDto) {
    return this.requisitionsService.list(user, query);
  }

  @Post()
  @RequireCapability(Capability.REQUEST)
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateRequisitionDto) {
    return this.requisitionsService.create(user, dto);
  }

  @Post('bundle')
  @RequireCapability(Capability.REQUEST)
  createBundle(@CurrentUser() user: CurrentUserData, @Body() dto: CreateRequisitionBundleDto) {
    return this.requisitionsService.createBundle(user, dto);
  }

  @Post('push-to-queue')
  @RequireCapability(Capability.APPROVE)
  pushToQueue(@CurrentUser() user: CurrentUserData, @Body() dto: PushToQueueDto) {
    return this.requisitionsService.pushToQueue(user, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.requisitionsService.findOne(user, id);
  }

  @Patch(':id')
  @RequireCapability(Capability.REQUEST)
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequisitionDto,
  ) {
    return this.requisitionsService.update(user, id, dto);
  }

  @Delete(':id')
  @RequireCapability(Capability.REQUEST)
  remove(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.requisitionsService.remove(user, id);
  }

  @Post(':id/submit')
  @RequireCapability(Capability.REQUEST)
  submit(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewRequisitionDto) {
    return this.requisitionsService.submit(user, id, dto);
  }

  @Post(':id/clear')
  @RequireCapability(Capability.PROCURE)
  clear(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewRequisitionDto) {
    return this.requisitionsService.clear(user, id, dto);
  }

  @Post(':id/return')
  @RequireCapability(Capability.PROCURE)
  returnToRequester(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewRequisitionDto,
  ) {
    return this.requisitionsService.returnToRequester(user, id, dto);
  }

  @Post(':id/reject')
  @RequireCapability(Capability.PROCURE)
  reject(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewRequisitionDto) {
    return this.requisitionsService.reject(user, id, dto);
  }

  /** Requester: SUBMITTED → DRAFT (own). Procurement: CLEARED/RETURNED/REJECTED → SUBMITTED (checked in the service). */
  @Post(':id/undo')
  @RequireCapability(Capability.REQUEST)
  undo(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewRequisitionDto) {
    return this.requisitionsService.undo(user, id, dto);
  }

  @Post(':id/attachments')
  @RequireCapability(Capability.REQUEST)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', ATTACHMENT_UPLOAD_OPTIONS))
  addAttachment(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    return this.requisitionsService.addAttachment(user, id, file);
  }

  @Get(':id/attachments')
  listAttachments(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.requisitionsService.listAttachments(user, id);
  }
}
