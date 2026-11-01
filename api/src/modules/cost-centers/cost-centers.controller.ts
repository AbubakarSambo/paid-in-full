import { Body, Controller, Delete, Get, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CostCentersService } from './cost-centers.service';
import { CreateCostCenterDto, UpdateCostCenterDto } from './dto';
import { ReorderDto } from '../pay-categories/dto/reorder.dto';
import { CurrentUser, CurrentUserData, Capability, RequireCapability } from '../../common';

/** Business Units. */
@ApiTags('Business Units (Cost Centers)')
@ApiBearerAuth()
@Controller('cost-centers')
export class CostCentersController {
  constructor(private readonly costCentersService: CostCentersService) {}

  @Get()
  @ApiOperation({ summary: 'List business units (optionally with their BU heads)' })
  @ApiQuery({ name: 'includeHeads', required: false, type: Boolean })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  async findAll(
    @CurrentUser('workspaceId') workspaceId: string,
    @Query('includeHeads', new ParseBoolPipe({ optional: true })) includeHeads?: boolean,
    @Query('activeOnly', new ParseBoolPipe({ optional: true })) activeOnly?: boolean,
  ) {
    return this.costCentersService.findAll(workspaceId, { includeHeads, activeOnly });
  }

  @Put('reorder')
  @RequireCapability(Capability.ADMIN)
  async reorder(@Body() dto: ReorderDto, @CurrentUser('workspaceId') workspaceId: string) {
    return this.costCentersService.reorder(workspaceId, dto.ids);
  }

  @Post()
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Create a business unit (name, code)' })
  async create(@Body() dto: CreateCostCenterDto, @CurrentUser() user: CurrentUserData) {
    return this.costCentersService.create(user.workspaceId, dto, user);
  }

  @Patch(':id')
  @RequireCapability(Capability.ADMIN)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCostCenterDto, @CurrentUser() user: CurrentUserData) {
    return this.costCentersService.update(user.workspaceId, id, dto, user);
  }

  @Delete(':id')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Delete a business unit (deactivates instead if referenced)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserData) {
    return this.costCentersService.remove(user.workspaceId, id, user);
  }
}
