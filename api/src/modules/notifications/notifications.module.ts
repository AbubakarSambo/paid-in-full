import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { WhatsAppService } from './whatsapp/whatsapp.service';
import { WhatsAppController } from './whatsapp/whatsapp.controller';

/** Global: inject NotificationsService (notify()) anywhere without importing this module. */
@Global()
@Module({
  controllers: [NotificationsController, WhatsAppController],
  providers: [NotificationsService, WhatsAppService],
  exports: [NotificationsService, WhatsAppService],
})
export class NotificationsModule {}
