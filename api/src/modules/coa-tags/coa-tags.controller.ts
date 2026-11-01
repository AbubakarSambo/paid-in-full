import { Body, Controller, Delete, Get, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';
import { CoaTagsService } from './coa-tags.service';
import { CreateCoaTagDto, DefaultSetupDto, ImportCoaTagsDto, SuggestCoaTagsDto, UpdateCoaTagDto } from './dto';

@ApiTags('COA Tags')
@ApiBearerAuth()
@Controller('coa-tags')
export class CoaTagsController {
  constructor(private readonly coaTags: CoaTagsService) {}

  @Get()
  @ApiQuery({ name: 'payCategoryId', required: false })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiOperation({ summary: 'List COA tags (optionally for one category)' })
  list(
    @CurrentUser('workspaceId') workspaceId: string,
    @Query('payCategoryId') payCategoryId?: string,
    @Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean,
  ) {
    return this.coaTags.list(workspaceId, { payCategoryId, includeInactive });
  }

  @Get('by-category')
  @ApiOperation({ summary: 'Categories with their COA tags, plus the workspace industry' })
  byCategory(@CurrentUser('workspaceId') workspaceId: string) {
    return this.coaTags.byCategory(workspaceId);
  }

  @Get('template.csv')
  @ApiQuery({ name: 'payCategoryId', required: false })
  @ApiOperation({ summary: 'CSV template (per category)' })
  async template(@CurrentUser('workspaceId') workspaceId: string, @Res() res: Response, @Query('payCategoryId') payCategoryId?: string) {
    const { fileName, csv } = await this.coaTags.templateCsv(workspaceId, payCategoryId || undefined);
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${fileName}"` });
    res.send(csv);
  }

  @Post('import')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Upload CSV of COA tags into a category (adds missing, skips duplicates)' })
  importCsv(@CurrentUser() user: CurrentUserData, @Body() dto: ImportCoaTagsDto) {
    return this.coaTags.importCsv(user.workspaceId, dto, user);
  }

  @Get('default-setup')
  @ApiQuery({ name: 'industry', required: false })
  @ApiOperation({ summary: 'Preview the one-click default setup (6 COS / 10 OPEX / 6 ASSET, industry-tailored)' })
  previewDefaults(@CurrentUser('workspaceId') workspaceId: string, @Query('industry') industry?: string) {
    return this.coaTags.previewDefaults(workspaceId, industry);
  }

  @Post('default-setup')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Apply the one-click default setup (409 requiresConfirmation unless confirmReplace)' })
  applyDefaults(@CurrentUser() user: CurrentUserData, @Body() dto: DefaultSetupDto) {
    return this.coaTags.applyDefaults(user.workspaceId, dto, user);
  }

  @Post('ai-suggest')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'AI Suggest COA tags for a category (industry-tailored; falls back to curated list)' })
  suggest(@CurrentUser('workspaceId') workspaceId: string, @Body() dto: SuggestCoaTagsDto) {
    return this.coaTags.suggest(workspaceId, dto);
  }

  @Post()
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Add a COA tag to a category' })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateCoaTagDto) {
    return this.coaTags.create(user.workspaceId, dto, user);
  }

  @Get(':id/usage')
  usage(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.coaTags.usage(workspaceId, id);
  }

  @Patch(':id')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Rename / reorder / toggle a COA tag' })
  update(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCoaTagDto) {
    return this.coaTags.update(user.workspaceId, id, dto, user);
  }

  @Delete(':id')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Delete a COA tag (409 if in use)' })
  remove(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.coaTags.remove(user.workspaceId, id, user);
  }
}
