import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { WorkspacesService } from './workspaces.service';
import { MembersService } from '../users/members.service';
import { UpdateWorkspaceDto, InviteMemberDto } from './dto';
import { UploadedImageFile } from '../uploads/image-upload';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';

@ApiTags('Workspaces')
@Controller('workspace')
export class WorkspacesController {
  constructor(
    private workspacesService: WorkspacesService,
    private members: MembersService,
  ) {}

  @Get()
  @RequireCapability(Capability.VIEW)
  findOne(@CurrentUser() user: CurrentUserData) {
    return this.workspacesService.findOne(user.workspaceId);
  }

  @Patch()
  @RequireCapability(Capability.ADMIN)
  update(@CurrentUser() user: CurrentUserData, @Body() dto: UpdateWorkspaceDto) {
    return this.workspacesService.update(user.workspaceId, user, dto);
  }

  /** multipart/form-data, field "file", image ≤ 2 MB. */
  @Post('logo')
  @RequireCapability(Capability.ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadLogo(@CurrentUser() user: CurrentUserData, @UploadedFile() file: UploadedImageFile) {
    return this.workspacesService.uploadLogo(user.workspaceId, user, file);
  }

  /** Legacy alias of POST /users/invite. */
  @Post('members')
  @RequireCapability(Capability.ADMIN)
  inviteMember(@CurrentUser() user: CurrentUserData, @Body() dto: InviteMemberDto) {
    return this.members.invite(user.workspaceId, user, { name: dto.name ?? '', email: dto.email, role: dto.role });
  }

  /** Legacy alias of DELETE /users/:userId. */
  @Delete('members/:userId')
  @RequireCapability(Capability.ADMIN)
  removeMember(@CurrentUser() user: CurrentUserData, @Param('userId') userId: string) {
    return this.members.remove(user.workspaceId, user, userId);
  }
}
