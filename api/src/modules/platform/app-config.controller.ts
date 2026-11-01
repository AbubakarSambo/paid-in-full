import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppConfigAdminService } from './app-config.service';
import { UpsertAppConfigDto } from './dto';
import { PlatformAdminGuard } from '../../common';

@ApiTags('Platform')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('platform/config')
export class AppConfigAdminController {
  constructor(private readonly appConfigService: AppConfigAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List all platform PlatformConfig key-value rows' })
  async list() {
    return this.appConfigService.list();
  }

  @Patch()
  @ApiOperation({ summary: 'Upsert a single PlatformConfig key-value row' })
  async upsert(@Body() dto: UpsertAppConfigDto) {
    return this.appConfigService.upsert(dto);
  }
}
