import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BudgetsService } from './budgets.service';
import { ImportBudgetsDto, QueryBudgetsDto, UpsertBudgetDto, VarianceQueryDto } from './dto';
import { CurrentUser, Roles, Role } from '../../common';

@ApiTags('Budgets')
@ApiBearerAuth()
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get('variance')
  @ApiOperation({ summary: 'Budget vs. actual spend variance report for a given month' })
  @ApiResponse({ status: 200, description: 'Variance report, sorted by variance descending' })
  async variance(
    @Query() query: VarianceQueryDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.budgetsService.getVarianceReport(workspaceId, query.period);
  }

  @Get()
  @ApiOperation({ summary: 'List budgets for the current workspace' })
  @ApiResponse({ status: 200, description: 'List of budgets' })
  async findAll(
    @Query() query: QueryBudgetsDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.budgetsService.findAll(workspaceId, query);
  }

  @Post('import')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Bulk import budgets from CSV (payCategory,costCenter,period,amount)' })
  @ApiResponse({ status: 201, description: 'Per-row import report' })
  async import(
    @Body() dto: ImportBudgetsDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.budgetsService.importCsv(workspaceId, dto.csv);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create or update (upsert) a budget for a period/category/cost-center' })
  @ApiResponse({ status: 201, description: 'Budget created or updated' })
  async upsert(
    @Body() dto: UpsertBudgetDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.budgetsService.upsert(workspaceId, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete a budget' })
  @ApiResponse({ status: 200, description: 'Budget deleted' })
  @ApiResponse({ status: 404, description: 'Budget not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.budgetsService.remove(workspaceId, id);
  }
}
