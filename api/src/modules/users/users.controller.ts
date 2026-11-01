import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from './users.service';
import { MembersService } from './members.service';
import { UploadedImageFile } from '../uploads/image-upload';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';
import { ChangePasswordDto, EditMemberNameDto, InviteUserDto, SetBillerDto, SetRoleDto, UpdateProfileDto } from './dto';

/** My profile (spec §5.10 #1–2). PIN routes live in SecurityController (/me/pin). */
@ApiTags('Users')
@Controller('me')
export class ProfileController {
  constructor(private usersService: UsersService) {}

  @Get()
  me(@CurrentUser() user: CurrentUserData) {
    return this.usersService.me(user.id, user.workspaceId);
  }

  @Patch()
  update(@CurrentUser() user: CurrentUserData, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, user.workspaceId, dto);
  }

  /** multipart/form-data, field "file", image ≤ 1 MB. */
  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadAvatar(@CurrentUser() user: CurrentUserData, @UploadedFile() file: UploadedImageFile) {
    return this.usersService.uploadAvatar(user.id, user.workspaceId, file);
  }

  @Delete('avatar')
  removeAvatar(@CurrentUser() user: CurrentUserData) {
    return this.usersService.removeAvatar(user.id, user.workspaceId);
  }

  @Post('password')
  @Throttle({ global: { limit: 5, ttl: 60000 } })
  changePassword(@CurrentUser() user: CurrentUserData, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }
}

/** Spec §5.9 Users tab. Everyone can view; every write is admin-only. */
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private members: MembersService,
  ) {}

  /** Legacy alias of GET /me. */
  @Get('me')
  me(@CurrentUser() user: CurrentUserData) {
    return this.usersService.me(user.id, user.workspaceId);
  }

  @Get()
  @RequireCapability(Capability.VIEW)
  list(@CurrentUser() user: CurrentUserData) {
    return this.members.list(user.workspaceId);
  }

  /** Legacy alias of GET /users. */
  @Get('workspace-members')
  @RequireCapability(Capability.VIEW)
  listWorkspaceMembers(@CurrentUser() user: CurrentUserData) {
    return this.members.list(user.workspaceId);
  }

  /** Member names for display (spec profile_directory()). */
  @Get('directory')
  @RequireCapability(Capability.VIEW)
  directory(@CurrentUser() user: CurrentUserData) {
    return this.members.directory(user.workspaceId);
  }

  @Post('invite')
  @RequireCapability(Capability.ADMIN)
  @Throttle({ global: { limit: 20, ttl: 60000 } })
  invite(@CurrentUser() user: CurrentUserData, @Body() dto: InviteUserDto) {
    return this.members.invite(user.workspaceId, user, dto);
  }

  @Post(':userId/resend-invite')
  @RequireCapability(Capability.ADMIN)
  @Throttle({ global: { limit: 10, ttl: 60000 } })
  resendInvite(@CurrentUser() user: CurrentUserData, @Param('userId') userId: string) {
    return this.members.resendInvite(user.workspaceId, user, userId);
  }

  @Patch(':userId')
  @RequireCapability(Capability.ADMIN)
  editName(@CurrentUser() user: CurrentUserData, @Param('userId') userId: string, @Body() dto: EditMemberNameDto) {
    return this.members.editName(user.workspaceId, userId, dto.name);
  }

  @Patch(':userId/role')
  @RequireCapability(Capability.ADMIN)
  setRole(@CurrentUser() user: CurrentUserData, @Param('userId') userId: string, @Body() dto: SetRoleDto) {
    return this.members.setRole(user.workspaceId, user, userId, dto.role);
  }

  @Patch(':userId/biller')
  @RequireCapability(Capability.ADMIN)
  setBiller(@CurrentUser() user: CurrentUserData, @Param('userId') userId: string, @Body() dto: SetBillerDto) {
    return this.members.setBiller(user.workspaceId, user, userId, dto.isBiller);
  }

  @Delete(':userId')
  @RequireCapability(Capability.ADMIN)
  remove(@CurrentUser() user: CurrentUserData, @Param('userId') userId: string) {
    return this.members.remove(user.workspaceId, user, userId);
  }
}
