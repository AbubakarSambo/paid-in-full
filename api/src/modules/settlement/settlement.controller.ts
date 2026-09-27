import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SettlementService } from './settlement.service';
import { CreateSettlementBatchDto, CreateSettlementBatchItemsDto } from './dto';
import { CurrentUser, CurrentUserData, PaginationDto, Roles, Role } from '../../common';

@ApiTags('Settlement')
@ApiBearerAuth()
@Controller('settlement')
export class SettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  @Get('batches')
  @ApiOperation({ summary: 'List settlement batches for the workspace (paginated)' })
  findAll(@CurrentUser() user: CurrentUserData, @Query() pagination: PaginationDto) {
    return this.settlementService.findAll(user.workspaceId, pagination);
  }

  @Get('batches/:id')
  @ApiOperation({ summary: 'Get a settlement batch and its reconciliation items' })
  findOne(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.settlementService.findOne(user.workspaceId, id);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post('batches')
  @ApiOperation({ summary: 'Register a Monnify settlement report against a disbursed Batch' })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateSettlementBatchDto) {
    return this.settlementService.createSettlementBatch(user.workspaceId, dto);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post('batches/:id/items')
  @ApiOperation({ summary: 'Upload settlement line items — auto-classified MATCHED/UNMATCHED against BatchItemPayout' })
  addItems(@CurrentUser() user: CurrentUserData, @Param('id') id: string, @Body() dto: CreateSettlementBatchItemsDto) {
    return this.settlementService.addItems(user.workspaceId, id, dto);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch('batches/:id/items/:itemId')
  @ApiOperation({ summary: 'Manually mark a settlement item as DISPUTED' })
  markDisputed(@CurrentUser() user: CurrentUserData, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.settlementService.markDisputed(user.workspaceId, id, itemId);
  }
}
