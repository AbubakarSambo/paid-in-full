import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';
import { ActivityService } from './activity.service';

@ApiTags('Workspaces')
@Controller()
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  /** Settings → Audit log (admin): last 100 sensitive actions. */
  @Get('audit-log')
  @RequireCapability(Capability.ADMIN)
  auditLog(@CurrentUser() user: CurrentUserData) {
    return this.activity.auditLog(user.workspaceId, 100);
  }

  /** Header bell: Recent Activity (any member). ?limit=30 (max 100). */
  @Get('activity')
  @RequireCapability(Capability.VIEW)
  feed(@CurrentUser() user: CurrentUserData, @Query('limit') limit?: string) {
    return this.activity.feed(user.workspaceId, user.id, Number(limit) || 30);
  }
}
