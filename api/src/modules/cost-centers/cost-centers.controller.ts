import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CostCentersService } from './cost-centers.service';
import { CreateCostCenterDto, UpdateCostCenterDto } from './dto';
import { CurrentUser, Roles, Role } from '../../common';

@ApiTags('Cost Centers')
@ApiBearerAuth()
@Controller('cost-centers')
export class CostCentersController {
  constructor(private readonly costCentersService: CostCentersService) {}

  @Get()
  @ApiOperation({ summary: 'List cost centers for the current workspace' })
  @ApiResponse({ status: 200, description: 'List of cost centers' })
  async findAll(@CurrentUser('workspaceId') workspaceId: string) {
    return this.costCentersService.findAll(workspaceId);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a cost center' })
  @ApiResponse({ status: 201, description: 'Cost center created' })
  async create(
    @Body() dto: CreateCostCenterDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.costCentersService.create(workspaceId, dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a cost center' })
  @ApiResponse({ status: 200, description: 'Cost center updated' })
  @ApiResponse({ status: 404, description: 'Cost center not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCostCenterDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.costCentersService.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Deactivate a cost center' })
  @ApiResponse({ status: 200, description: 'Cost center deactivated' })
  @ApiResponse({ status: 404, description: 'Cost center not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.costCentersService.remove(workspaceId, id);
  }
}
