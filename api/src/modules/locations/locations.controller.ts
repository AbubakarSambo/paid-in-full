import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LocationsService } from './locations.service';
import { CreateLocationDto, UpdateLocationDto } from './dto';
import { CurrentUser, Roles, Role } from '../../common';

@ApiTags('Locations')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  @ApiOperation({ summary: 'List locations for the current workspace' })
  @ApiResponse({ status: 200, description: 'List of locations' })
  async findAll(@CurrentUser('workspaceId') workspaceId: string) {
    return this.locationsService.findAll(workspaceId);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a location' })
  @ApiResponse({ status: 201, description: 'Location created' })
  async create(
    @Body() dto: CreateLocationDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.locationsService.create(workspaceId, dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a location' })
  @ApiResponse({ status: 200, description: 'Location updated' })
  @ApiResponse({ status: 404, description: 'Location not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.locationsService.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Deactivate a location' })
  @ApiResponse({ status: 200, description: 'Location deactivated' })
  @ApiResponse({ status: 404, description: 'Location not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.locationsService.remove(workspaceId, id);
  }
}
