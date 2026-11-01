import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';
import { SheetsService } from './sheets.service';
import { BackfillSheetsDto, SaveSheetsConfigDto, TestSheetsDto, WipeRepushDto } from './dto';

@ApiTags('Google Sheets')
@ApiBearerAuth()
@Controller('sheets')
export class SheetsController {
  constructor(private readonly sheets: SheetsService) {}

  @Get('status')
  @RequireCapability(Capability.VIEW)
  @ApiOperation({ summary: 'Sync state for the header pill (Not synced / Syncing / Synced / Error)' })
  status(@CurrentUser('workspaceId') workspaceId: string) {
    return this.sheets.status(workspaceId);
  }

  @Get('config')
  @RequireCapability(Capability.ADMIN)
  getConfig(@CurrentUser('workspaceId') workspaceId: string) {
    return this.sheets.getConfig(workspaceId);
  }

  @Put('config')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Save sheet URLs / tab names (transport is picked from the URL format)' })
  saveConfig(@CurrentUser() user: CurrentUserData, @Body() dto: SaveSheetsConfigDto) {
    return this.sheets.saveConfig(user.workspaceId, user, dto);
  }

  @Post('test')
  @HttpCode(200)
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Write a TEST row to the batches (or invoices) tab' })
  test(@CurrentUser() user: CurrentUserData, @Body() dto: TestSheetsDto) {
    return this.sheets.test(user.workspaceId, dto.target ?? 'batches', user.email);
  }

  @Post('batches/:id/resync')
  @HttpCode(200)
  @RequireCapability(Capability.APPROVE)
  @ApiOperation({ summary: 'Resend one batch’s rows to the sheet' })
  resyncBatch(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sheets.resyncBatch(workspaceId, id);
  }

  @Post('invoices/:id/resync')
  @HttpCode(200)
  @RequireCapability(Capability.INVOICE)
  resyncInvoice(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sheets.resyncInvoice(workspaceId, id);
  }

  @Post('backfill')
  @HttpCode(200)
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Push every not-yet-synced batch dated on/after a date' })
  backfill(@CurrentUser() user: CurrentUserData, @Body() dto: BackfillSheetsDto) {
    return this.sheets.backfill(user.workspaceId, dto.from, user);
  }

  @Post('wipe-repush')
  @HttpCode(200)
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Clear the BATCHES tab and rewrite every row in the 16-column layout (confirm: true)' })
  wipeRepush(@CurrentUser() user: CurrentUserData, @Body() _dto: WipeRepushDto) {
    return this.sheets.wipeAndRepush(user.workspaceId, user);
  }

  @Get('recon')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Sheet Recon: compare the mastersheet with app lines' })
  recon(@CurrentUser('workspaceId') workspaceId: string) {
    return this.sheets.recon(workspaceId);
  }

  @Post('recon/fill')
  @HttpCode(200)
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Fill BU / BU Head into the sheet for Fixable rows' })
  reconFill(@CurrentUser() user: CurrentUserData) {
    return this.sheets.reconFill(user.workspaceId, user);
  }
}
