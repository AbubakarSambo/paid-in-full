import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';
import { SuperAdminService } from './super-admin.service';
import { DeleteClientDto, ListClientsDto, ManageClientDto, NewClientDto, TeamEmailDto } from './dto';

/**
 * Spec §14 /super-admin. Controller default: CLIENT_SETUP or SUPER_ADMIN (money stripped for
 * CLIENT_SETUP). Routes marked SUPER_ADMIN override that.
 */
@ApiTags('Platform')
@Controller('super-admin')
@RequireCapability(Capability.CLIENT_SETUP)
export class SuperAdminController {
  constructor(private readonly superAdmin: SuperAdminService) {}

  @Get('kpis')
  kpis(@CurrentUser() user: CurrentUserData) {
    return this.superAdmin.kpis(user);
  }

  @Get('clients')
  list(@CurrentUser() user: CurrentUserData, @Query() query: ListClientsDto) {
    return this.superAdmin.listClients(user, query);
  }

  @Post('clients')
  newClient(@CurrentUser() user: CurrentUserData, @Body() dto: NewClientDto) {
    return this.superAdmin.newClient(user, dto);
  }

  @Get('clients/:id')
  getClient(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.superAdmin.getClient(user, id);
  }

  @Patch('clients/:id')
  @RequireCapability(Capability.SUPER_ADMIN)
  manage(@CurrentUser() user: CurrentUserData, @Param('id') id: string, @Body() dto: ManageClientDto) {
    return this.superAdmin.manageClient(user, id, dto);
  }

  /** Body: { confirmName } — must equal the workspace name. */
  @Delete('clients/:id')
  @RequireCapability(Capability.SUPER_ADMIN)
  remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string, @Body() dto: DeleteClientDto) {
    return this.superAdmin.deleteClient(user, id, dto.confirmName);
  }

  @Post('clients/:id/open')
  @HttpCode(200)
  @RequireCapability(Capability.SUPER_ADMIN)
  open(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.superAdmin.openClient(user, id);
  }

  @Get('team')
  @RequireCapability(Capability.SUPER_ADMIN)
  team() {
    return this.superAdmin.listTeam();
  }

  @Post('team/grant')
  @HttpCode(200)
  @RequireCapability(Capability.SUPER_ADMIN)
  grant(@CurrentUser() user: CurrentUserData, @Body() dto: TeamEmailDto) {
    return this.superAdmin.grantClientSetup(user, dto.email);
  }

  @Post('team/remove')
  @HttpCode(200)
  @RequireCapability(Capability.SUPER_ADMIN)
  revoke(@CurrentUser() user: CurrentUserData, @Body() dto: TeamEmailDto) {
    return this.superAdmin.removeClientSetup(user, dto.email);
  }

  @Get('auto-debit')
  @RequireCapability(Capability.SUPER_ADMIN)
  autoDebit() {
    return this.superAdmin.autoDebitOverview();
  }
}
