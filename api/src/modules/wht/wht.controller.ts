import { Body, Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Role, Roles } from '../../common';
import { UpsertWhtRateDto, WhtLedgerQueryDto } from './dto';
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

  @Patch('rates/:payCategoryId')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  upsertRate(
    @CurrentUser('workspaceId') workspaceId: string,
    @Param('payCategoryId') payCategoryId: string,
    @Body() dto: UpsertWhtRateDto,
  ) {
    return this.whtService.upsertRate(workspaceId, payCategoryId, dto);
  }

  @Delete('rates/:payCategoryId')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  removeRateOverride(@CurrentUser('workspaceId') workspaceId: string, @Param('payCategoryId') payCategoryId: string) {
    return this.whtService.removeRateOverride(workspaceId, payCategoryId);
  }

  @Get('ledger')
  listLedger(@CurrentUser('workspaceId') workspaceId: string, @Query() query: WhtLedgerQueryDto) {
    return this.whtService.listLedger(workspaceId, query);
  }
}
