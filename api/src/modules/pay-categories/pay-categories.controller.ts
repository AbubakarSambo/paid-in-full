import { Body, Controller, Delete, Get, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PayCategoriesService } from './pay-categories.service';
import { CreatePayCategoryDto, ReorderDto, UpdatePayCategoryDto } from './dto';
import { CurrentUser, CurrentUserData, Capability, RequireCapability } from '../../common';

@ApiTags('Pay Categories')
@ApiBearerAuth()
@Controller('pay-categories')
export class PayCategoriesController {
  constructor(private readonly payCategoriesService: PayCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List pay categories (sorted), optionally with their active COA tags' })
  @ApiQuery({ name: 'includeTags', required: false, type: Boolean })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  async findAll(
    @CurrentUser('workspaceId') workspaceId: string,
    @Query('includeTags', new ParseBoolPipe({ optional: true })) includeTags?: boolean,
    @Query('activeOnly', new ParseBoolPipe({ optional: true })) activeOnly?: boolean,
  ) {
    return this.payCategoriesService.findAll(workspaceId, { includeTags, activeOnly });
  }

  @Put('reorder')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Reorder pay categories (ids in display order)' })
  async reorder(@Body() dto: ReorderDto, @CurrentUser() user: CurrentUserData) {
    return this.payCategoriesService.reorder(user.workspaceId, dto, user);
  }

  @Get(':id/usage')
  @ApiOperation({ summary: 'Records referencing this category (delete is blocked when in use)' })
  async usage(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    await this.payCategoriesService.findOne(workspaceId, id);
    return this.payCategoriesService.usage(workspaceId, id);
  }

  @Post()
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Create a pay category (audit: category.created)' })
  @ApiResponse({ status: 201, description: 'Pay category created' })
  async create(@Body() dto: CreatePayCategoryDto, @CurrentUser() user: CurrentUserData) {
    return this.payCategoriesService.create(user.workspaceId, dto, user);
  }

  @Patch(':id')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Update / rename a pay category, toggle budgets, colour, active' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayCategoryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.payCategoriesService.update(user.workspaceId, id, dto, user);
  }

  @Delete(':id')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Delete a pay category (409 if it is in use)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserData) {
    return this.payCategoriesService.remove(user.workspaceId, id, user);
  }
}
