import { BadRequestException, Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Allow, IsObject } from 'class-validator';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';
import { AppConfigService } from './app-config.service';
import { isAllowedAppConfigKey } from './app-config.keys';

class SetAppConfigDto {
  @Allow()
  value: unknown;
}

class SetManyAppConfigDto {
  @IsObject()
  values: Record<string, unknown>;
}

@ApiTags('Workspaces')
@Controller('app-config')
export class AppConfigController {
  constructor(private readonly appConfig: AppConfigService) {}

  @Get()
  @RequireCapability(Capability.VIEW)
  getAll(@CurrentUser() user: CurrentUserData) {
    return this.appConfig.getAll(user.workspaceId);
  }

  @Get(':key')
  @RequireCapability(Capability.VIEW)
  async getOne(@CurrentUser() user: CurrentUserData, @Param('key') key: string) {
    this.assertKey(key);
    return { key, value: await this.appConfig.get(user.workspaceId, key) };
  }

  @Put(':key')
  @RequireCapability(Capability.ADMIN)
  setOne(@CurrentUser() user: CurrentUserData, @Param('key') key: string, @Body() body: SetAppConfigDto) {
    this.assertKey(key);
    if (!body || !('value' in body)) throw new BadRequestException('Body must be { "value": ... }');
    return this.appConfig.set(user.workspaceId, key, body.value, user);
  }

  @Patch()
  @RequireCapability(Capability.ADMIN)
  setMany(@CurrentUser() user: CurrentUserData, @Body() dto: SetManyAppConfigDto) {
    for (const k of Object.keys(dto.values)) this.assertKey(k);
    return this.appConfig.setMany(user.workspaceId, dto.values, user);
  }

  private assertKey(key: string) {
    if (!isAllowedAppConfigKey(key)) throw new BadRequestException(`Unknown setting "${key}"`);
  }
}
