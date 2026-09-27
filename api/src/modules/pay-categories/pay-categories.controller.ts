import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PayCategoriesService } from './pay-categories.service';
import { CreatePayCategoryDto, UpdatePayCategoryDto } from './dto';
import { CurrentUser, Roles, Role } from '../../common';

@ApiTags('Pay Categories')
@ApiBearerAuth()
@Controller('pay-categories')
export class PayCategoriesController {
  constructor(private readonly payCategoriesService: PayCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List pay categories for the current workspace' })
  @ApiResponse({ status: 200, description: 'List of pay categories' })
  async findAll(@CurrentUser('workspaceId') workspaceId: string) {
    return this.payCategoriesService.findAll(workspaceId);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a pay category' })
  @ApiResponse({ status: 201, description: 'Pay category created' })
  async create(
    @Body() dto: CreatePayCategoryDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.payCategoriesService.create(workspaceId, dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a pay category' })
  @ApiResponse({ status: 200, description: 'Pay category updated' })
  @ApiResponse({ status: 404, description: 'Pay category not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayCategoryDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.payCategoriesService.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Deactivate a pay category' })
  @ApiResponse({ status: 200, description: 'Pay category deactivated' })
  @ApiResponse({ status: 404, description: 'Pay category not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.payCategoriesService.remove(workspaceId, id);
  }
}
