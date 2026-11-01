import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationPrefsDto, PushSubscribeDto, PushUnsubscribeDto } from './dto';
import { Capability, CurrentUser, CurrentUserData, Public, RequireCapability } from '../../common';

/** Settings → Notifications (spec §5.10 #21). Personal prefs: any member. */
@ApiTags('Notifications')
@Controller('notifications')
@RequireCapability(Capability.VIEW)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get('prefs')
  getPrefs(@CurrentUser() user: CurrentUserData) {
    return this.notificationsService.getPrefs(user.workspaceId, user.id);
  }

  @Patch('prefs')
  updatePrefs(@CurrentUser() user: CurrentUserData, @Body() dto: UpdateNotificationPrefsDto) {
    return this.notificationsService.updatePrefs(user.workspaceId, user.id, dto.prefs);
  }

  @Post('push/subscribe')
  subscribePush(@CurrentUser() user: CurrentUserData, @Body() dto: PushSubscribeDto) {
    return this.notificationsService.subscribePush(user.workspaceId, user.id, dto);
  }

  @Post('push/unsubscribe')
  @HttpCode(200)
  unsubscribe(@CurrentUser() user: CurrentUserData, @Body() dto: PushUnsubscribeDto) {
    return this.notificationsService.unsubscribePush(user.id, dto.endpoint, user.workspaceId);
  }

  /** Legacy: endpoint URL-encoded in the path. */
  @Delete('push/subscribe/:endpoint')
  unsubscribePush(@CurrentUser() user: CurrentUserData, @Param('endpoint') endpoint: string) {
    return this.notificationsService.unsubscribePush(user.id, decodeURIComponent(endpoint));
  }

  @Post('test')
  @HttpCode(200)
  @Throttle({ global: { limit: 5, ttl: 60000 } })
  sendTest(@CurrentUser() user: CurrentUserData) {
    return this.notificationsService.sendTest(user.workspaceId, user.id);
  }

  @Public()
  @Get('push/vapid-public-key')
  getVapidPublicKey() {
    return { vapidPublicKey: this.notificationsService.getVapidPublicKey() || null };
  }
}
