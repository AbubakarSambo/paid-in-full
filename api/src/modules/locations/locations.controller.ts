import { Body, Controller, Delete, Get, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LocationsService } from './locations.service';
import { CreateLocationDto, UpdateLocationDto } from './dto';
import { ReorderDto } from '../pay-categories/dto/reorder.dto';
import { CurrentUser, CurrentUserData, Capability, RequireCapability } from '../../common';

/** BU Heads. */
@ApiTags('BU Heads (Locations)')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  @ApiQuery({ name: 'costCenterId', required: false })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  @ApiOperation({ summary: 'List BU heads (optionally for one business unit)' })
  async findAll(
    @CurrentUser('workspaceId') workspaceId: string,
    @Query('costCenterId') costCenterId?: string,
    @Query('activeOnly', new ParseBoolPipe({ optional: true })) activeOnly?: boolean,
  ) {
    return this.locationsService.findAll(workspaceId, { costCenterId, activeOnly });
  }

  @Put('reorder')
  @RequireCapability(Capability.ADMIN)
  async reorder(@Body() dto: ReorderDto, @CurrentUser('workspaceId') workspaceId: string) {
    return this.locationsService.reorder(workspaceId, dto.ids);
  }

  @Post()
  @RequireCapability(Capability.ADMIN)
  async create(@Body() dto: CreateLocationDto, @CurrentUser() user: CurrentUserData) {
    return this.locationsService.create(user.workspaceId, dto, user);
  }

  @Patch(':id')
  @RequireCapability(Capability.ADMIN)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLocationDto, @CurrentUser() user: CurrentUserData) {
    return this.locationsService.update(user.workspaceId, id, dto, user);
  }

  @Delete(':id')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Delete a BU head (deactivates instead if referenced)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserData) {
    return this.locationsService.remove(user.workspaceId, id, user);
  }
}
