import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class PushDefaultsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  payCategoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  coaTagId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ example: '2026-10' })
  @IsOptional()
  @Matches(PERIOD, { message: 'pnlPeriod must be YYYY-MM' })
  pnlPeriod?: string;
}

export class PushLineDto extends PushDefaultsDto {
  @ApiProperty()
  @IsUUID()
  requisitionId: string;

  @ApiPropertyOptional({ description: 'WHT rate override, fraction 0–1' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  whtRateOverride?: number;
}

export class PushToQueueDto {
  @ApiProperty({ type: [PushLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PushLineDto)
  lines: PushLineDto[];

  @ApiPropertyOptional({ type: PushDefaultsDto, description: '"Apply to all": fills values missing on a line' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PushDefaultsDto)
  applyToAll?: PushDefaultsDto;
}
