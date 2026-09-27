import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WorkspacesService } from './workspaces.service';
import { UpdateWorkspaceDto, InviteMemberDto } from './dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/decorators/roles.decorator';

@ApiTags('Workspaces')
@Controller('workspace')
export class WorkspacesController {
  constructor(private workspacesService: WorkspacesService) {}

  @Get()
  findOne(@CurrentUser() user: CurrentUserData) {
    return this.workspacesService.findOne(user.workspaceId);
  }

  @Patch()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  update(@CurrentUser() user: CurrentUserData, @Body() dto: UpdateWorkspaceDto) {
    return this.workspacesService.update(user.workspaceId, dto);
  }

  @Post('members')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  inviteMember(@CurrentUser() user: CurrentUserData, @Body() dto: InviteMemberDto) {
    return this.workspacesService.inviteMember(user.workspaceId, dto);
  }

  @Delete('members/:userId')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  removeMember(@CurrentUser() user: CurrentUserData, @Param('userId') userId: string) {
    return this.workspacesService.removeMember(user.workspaceId, userId);
  }
}
