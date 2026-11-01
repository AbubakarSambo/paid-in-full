import { Body, Controller, Delete, Get, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto';
import { CurrentUser, Capability, RequireCapability } from '../../common';

@ApiTags('Departments')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List departments for the current workspace' })
  @ApiResponse({ status: 200, description: 'List of departments' })
  async findAll(
    @CurrentUser('workspaceId') workspaceId: string,
    @Query('activeOnly', new ParseBoolPipe({ optional: true })) activeOnly?: boolean,
  ) {
    return this.departmentsService.findAll(workspaceId, { activeOnly });
  }

  @Get('suggestions')
  @ApiOperation({ summary: 'Department suggestions for the free-text field (workspace first, then common names)' })
  async suggestions(@CurrentUser('workspaceId') workspaceId: string, @Query('q') q?: string) {
    return this.departmentsService.suggestions(workspaceId, q);
  }

  @Post()
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Create a department' })
  @ApiResponse({ status: 201, description: 'Department created' })
  async create(
    @Body() dto: CreateDepartmentDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.departmentsService.create(workspaceId, dto);
  }

  @Patch(':id')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Update a department' })
  @ApiResponse({ status: 200, description: 'Department updated' })
  @ApiResponse({ status: 404, description: 'Department not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.departmentsService.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Deactivate a department' })
  @ApiResponse({ status: 200, description: 'Department deactivated' })
  @ApiResponse({ status: 404, description: 'Department not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.departmentsService.remove(workspaceId, id);
  }
}
