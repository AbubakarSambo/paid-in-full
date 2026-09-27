import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserData, Role, Roles } from '../../common';
import { CreateRequisitionDto, PushToQueueDto, RejectRequisitionDto, RequisitionQueryDto } from './dto';
import { RequisitionsService } from './requisitions.service';

@ApiTags('Requisitions')
@ApiBearerAuth()
@Controller('requisitions')
export class RequisitionsController {
  constructor(private readonly requisitionsService: RequisitionsService) {}

  @Post()
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateRequisitionDto) {
    return this.requisitionsService.create(user.workspaceId, user.id, dto);
  }

  @Get()
  list(@CurrentUser('workspaceId') workspaceId: string, @Query() query: RequisitionQueryDto) {
    return this.requisitionsService.list(workspaceId, query);
  }

  @Post('push-to-queue')
  pushToQueue(@CurrentUser() user: CurrentUserData, @Body() dto: PushToQueueDto) {
    return this.requisitionsService.pushToQueue(user.workspaceId, user.id, dto);
  }

  @Get(':id')
  findOne(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.requisitionsService.findOne(workspaceId, id);
  }

  @Patch(':id/approve')
  @Roles(Role.ADMIN, Role.APPROVER, Role.SUPER_ADMIN)
  approve(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.requisitionsService.approve(user.workspaceId, id, user.id);
  }

  @Patch(':id/reject')
  @Roles(Role.ADMIN, Role.APPROVER, Role.SUPER_ADMIN)
  reject(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectRequisitionDto,
  ) {
    return this.requisitionsService.reject(user.workspaceId, id, user.id, dto);
  }
}
