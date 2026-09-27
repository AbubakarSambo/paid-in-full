import { Controller, Get, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlatformWorkspacesService } from './workspaces.service';
import { ListWorkspacesDto, ToggleGrandfatherDto } from './dto';
import { PlatformAdminGuard } from '../../common';

@ApiTags('Platform')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('platform/workspaces')
export class PlatformWorkspacesController {
  constructor(private readonly workspacesService: PlatformWorkspacesService) {}

  @Get()
  @ApiOperation({ summary: 'Paginated list of all workspaces on the platform' })
  async list(@Query() query: ListWorkspacesDto) {
    return this.workspacesService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single workspace, with member/vendor/batch counts' })
  async findOne(@Param('id') id: string) {
    return this.workspacesService.findOne(id);
  }

  @Patch(':id/grandfather')
  @ApiOperation({ summary: 'Toggle (or explicitly set) a workspace isGrandfathered flag' })
  async toggleGrandfather(@Param('id') id: string, @Body() dto: ToggleGrandfatherDto) {
    return this.workspacesService.toggleGrandfather(id, dto);
  }
}
