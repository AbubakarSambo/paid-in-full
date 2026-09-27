import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserData, Role, Roles } from '../../common';
import { BatchesService } from './batches.service';
import { BatchQueryDto, CreateBatchDto, DisburseBatchDto } from './dto';

@ApiTags('Batches')
@ApiBearerAuth()
@Controller('batches')
export class BatchesController {
  constructor(private readonly batchesService: BatchesService) {}

  @Get()
  list(@CurrentUser('workspaceId') workspaceId: string, @Query() query: BatchQueryDto) {
    return this.batchesService.list(workspaceId, query);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateBatchDto) {
    return this.batchesService.create(user.workspaceId, user.id, dto);
  }

  @Get(':id')
  findOne(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.batchesService.findOne(workspaceId, id);
  }

  @Patch(':id/approve')
  @Roles(Role.ADMIN, Role.APPROVER, Role.SUPER_ADMIN)
  approve(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.batchesService.approve(user.workspaceId, id, user.id);
  }

  @Post(':id/disburse')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  disburse(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisburseBatchDto,
  ) {
    return this.batchesService.disburse(user.workspaceId, id, user.id, dto);
  }
}
