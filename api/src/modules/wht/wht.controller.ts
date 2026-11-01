import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserData, Capability, RequireCapability } from '../../common';
import { ResolveWhtDto, SeedWhtDefaultsDto, UpdateWhtAccountDto, UpdateWhtRateDto, UpsertWhtRateDto, WhtLedgerQueryDto } from './dto';
import { WhtService } from './wht.service';

@ApiTags('Withholding Tax')
@ApiBearerAuth()
@Controller('wht')
export class WhtController {
  constructor(private readonly whtService: WhtService) {}

  @Get('rates')
  listRates(@CurrentUser('workspaceId') workspaceId: string) {
    return this.whtService.listRates(workspaceId);
  }

  @Get('rates/defaults')
  @ApiOperation({ summary: 'Nigerian statutory WHT defaults (not yet applied)' })
  statutoryDefaults() {
    return this.whtService.statutoryDefaults();
  }

  @Post('rates/seed-defaults')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Seed the Nigerian statutory defaults into this workspace' })
  seedDefaults(@CurrentUser() user: CurrentUserData, @Body() dto: SeedWhtDefaultsDto) {
    return this.whtService.seedDefaults(user.workspaceId, dto, user);
  }

  @Post('rates')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Create (or update by COA) a per-COA WHT rate' })
  createRate(@CurrentUser() user: CurrentUserData, @Body() dto: UpsertWhtRateDto) {
    return this.whtService.upsertRate(user.workspaceId, dto, user);
  }

  @Put('rates')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Upsert a per-COA WHT rate (matched case-insensitively on COA)' })
  upsertRate(@CurrentUser() user: CurrentUserData, @Body() dto: UpsertWhtRateDto) {
    return this.whtService.upsertRate(user.workspaceId, dto, user);
  }

  @Patch('rates/:id')
  @RequireCapability(Capability.ADMIN)
  updateRate(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWhtRateDto) {
    return this.whtService.updateRate(user.workspaceId, id, dto, user);
  }

  @Delete('rates/:id')
  @RequireCapability(Capability.ADMIN)
  removeRate(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.whtService.removeRate(user.workspaceId, id, user);
  }

  @Post('resolve')
  @ApiOperation({ summary: 'Resolve the WHT rate for a vendor + COA (spec §6), with gross/wht/net when total given' })
  resolve(@CurrentUser('workspaceId') workspaceId: string, @Body() dto: ResolveWhtDto) {
    return this.whtService.resolve(workspaceId, dto);
  }

  @Get('account')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'WHT destination account (AppConfig wht_account_*)' })
  getAccount(@CurrentUser('workspaceId') workspaceId: string) {
    return this.whtService.getAccount(workspaceId);
  }

  @Put('account')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Set the WHT destination account (bank name enquiry; manual name only with allowUnverified)' })
  updateAccount(@CurrentUser() user: CurrentUserData, @Body() dto: UpdateWhtAccountDto) {
    return this.whtService.updateAccount(user.workspaceId, dto, user);
  }

  @Delete('account')
  @RequireCapability(Capability.ADMIN)
  clearAccount(@CurrentUser() user: CurrentUserData) {
    return this.whtService.clearAccount(user.workspaceId, user);
  }

  @Get('ledger')
  listLedger(@CurrentUser('workspaceId') workspaceId: string, @Query() query: WhtLedgerQueryDto) {
    return this.whtService.listLedger(workspaceId, query);
  }
}
