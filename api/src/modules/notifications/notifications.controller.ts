import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationPrefsDto, PushSubscribeDto } from './dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Notifications')
@Controller('notifications')
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

  @Delete('push/subscribe/:endpoint')
  unsubscribePush(@CurrentUser() user: CurrentUserData, @Param('endpoint') endpoint: string) {
    return this.notificationsService.unsubscribePush(user.id, decodeURIComponent(endpoint));
  }

  @Public()
  @Get('push/vapid-public-key')
  getVapidPublicKey() {
    return { vapidPublicKey: this.notificationsService.getVapidPublicKey() || null };
  }
}
