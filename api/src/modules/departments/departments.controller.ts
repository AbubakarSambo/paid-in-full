import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto';
import { CurrentUser, Roles, Role } from '../../common';

@ApiTags('Departments')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List departments for the current workspace' })
  @ApiResponse({ status: 200, description: 'List of departments' })
  async findAll(@CurrentUser('workspaceId') workspaceId: string) {
    return this.departmentsService.findAll(workspaceId);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a department' })
  @ApiResponse({ status: 201, description: 'Department created' })
  async create(
    @Body() dto: CreateDepartmentDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.departmentsService.create(workspaceId, dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
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
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
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
