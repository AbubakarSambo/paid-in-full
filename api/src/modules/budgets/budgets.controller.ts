import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BudgetsService } from './budgets.service';
import {
  BudgetImportCommitDto,
  BudgetImportPreviewDto,
  BudgetOverviewQueryDto,
  CopyPreviousBudgetsDto,
  CreateBudgetTagDto,
  QueryBudgetsDto,
  UpsertBudgetDto,
  VarianceQueryDto,
} from './dto';
import { CurrentUser, CurrentUserData, Capability, RequireCapability } from '../../common';

@ApiTags('Budgets')
@ApiBearerAuth()
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Budgets screen: caps, spend and KPIs per budgeted COA tag for a month/BU' })
  overview(@CurrentUser('workspaceId') workspaceId: string, @Query() query: BudgetOverviewQueryDto) {
    return this.budgetsService.overview(workspaceId, query);
  }

  @Get('variance')
  @ApiOperation({ summary: 'Variance report for a period preset or custom range (budgets pro-rated by days)' })
  variance(@CurrentUser('workspaceId') workspaceId: string, @Query() query: VarianceQueryDto) {
    return this.budgetsService.variance(workspaceId, query);
  }

  @Get()
  @ApiOperation({ summary: 'List budget caps' })
  findAll(@CurrentUser('workspaceId') workspaceId: string, @Query() query: QueryBudgetsDto) {
    return this.budgetsService.findAll(workspaceId, query);
  }

  @Put()
  @RequireCapability(Capability.APPROVE)
  @ApiOperation({ summary: 'Set or edit a monthly cap (month × BU × COA tag)' })
  upsert(@CurrentUser() user: CurrentUserData, @Body() dto: UpsertBudgetDto) {
    return this.budgetsService.upsert(user.workspaceId, user, dto);
  }

  /** Legacy alias of PUT /budgets. */
  @Post()
  @RequireCapability(Capability.APPROVE)
  upsertPost(@CurrentUser() user: CurrentUserData, @Body() dto: UpsertBudgetDto) {
    return this.budgetsService.upsert(user.workspaceId, user, dto);
  }

  @Post('copy-previous')
  @RequireCapability(Capability.APPROVE)
  @ApiOperation({ summary: 'Copy caps from the previous month' })
  copyPrevious(@CurrentUser() user: CurrentUserData, @Body() dto: CopyPreviousBudgetsDto) {
    return this.budgetsService.copyPrevious(user.workspaceId, user, dto);
  }

  @Post('tags')
  @RequireCapability(Capability.APPROVE)
  @ApiOperation({ summary: 'Add a new COA tag inline (budgeted category)' })
  createTag(@CurrentUser('workspaceId') workspaceId: string, @Body() dto: CreateBudgetTagDto) {
    return this.budgetsService.createTag(workspaceId, dto);
  }

  @Post('import/preview')
  @RequireCapability(Capability.APPROVE)
  @ApiOperation({ summary: 'Import wizard: parse CSV and propose column + COA mapping' })
  importPreview(@CurrentUser('workspaceId') workspaceId: string, @Body() dto: BudgetImportPreviewDto) {
    return this.budgetsService.importPreview(workspaceId, dto);
  }

  @Post('import/commit')
  @RequireCapability(Capability.APPROVE)
  @ApiOperation({ summary: 'Import wizard: write mapped rows as caps for a month/BU' })
  importCommit(@CurrentUser() user: CurrentUserData, @Body() dto: BudgetImportCommitDto) {
    return this.budgetsService.importCommit(user.workspaceId, user, dto);
  }

  @Delete(':id')
  @RequireCapability(Capability.APPROVE)
  @ApiOperation({ summary: 'Remove a cap' })
  remove(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.budgetsService.remove(user.workspaceId, user, id);
  }
}
