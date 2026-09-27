import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: CurrentUserData) {
    return this.usersService.me(user.id, user.workspaceId);
  }

  @Get('workspace-members')
  listWorkspaceMembers(@CurrentUser() user: CurrentUserData) {
    return this.usersService.listWorkspaceMembers(user.workspaceId);
  }
}
