import { IsArray, IsBoolean, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, NotificationChannel, NotificationEvent } from '../notification-events';

export { NOTIFICATION_CHANNELS };
export type { NotificationChannel };

export class NotificationPrefItemDto {
  @ApiProperty({ enum: NOTIFICATION_CHANNELS })
  @IsIn(NOTIFICATION_CHANNELS as unknown as string[])
  channel: NotificationChannel;

  @ApiProperty({ enum: NOTIFICATION_EVENTS })
  @IsIn(NOTIFICATION_EVENTS as unknown as string[])
  event: NotificationEvent;

  @ApiProperty()
  @IsBoolean()
  isEnabled: boolean;
}

export class UpdateNotificationPrefsDto {
  @ApiProperty({ type: [NotificationPrefItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotificationPrefItemDto)
  prefs: NotificationPrefItemDto[];
}
