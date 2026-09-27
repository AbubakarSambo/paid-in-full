import { IsArray, IsBoolean, IsIn, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export const NOTIFICATION_CHANNELS = ['EMAIL', 'PUSH', 'WHATSAPP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export class NotificationPrefItemDto {
  @ApiProperty({ enum: NOTIFICATION_CHANNELS })
  @IsIn(NOTIFICATION_CHANNELS)
  channel: NotificationChannel;

  @ApiProperty({ example: 'QUEUE_ITEM_ADDED' })
  @IsString()
  event: string;

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
