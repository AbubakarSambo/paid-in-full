import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PushPlatform } from '@prisma/client';

export class PushSubscribeDto {
  @ApiProperty()
  @IsString()
  endpoint: string;

  @ApiProperty()
  @IsString()
  p256dhKey: string;

  @ApiProperty()
  @IsString()
  authKey: string;

  @ApiPropertyOptional({ enum: PushPlatform })
  @IsOptional()
  @IsEnum(PushPlatform)
  platform?: PushPlatform;
}

export class PushUnsubscribeDto {
  /** Omit to remove every push subscription of mine in this workspace. */
  @IsOptional()
  @IsString()
  endpoint?: string;
}
