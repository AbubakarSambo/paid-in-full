import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ToggleGrandfatherDto {
  @ApiPropertyOptional({ description: 'Explicit value to set. Omit to toggle the current value.' })
  @IsOptional()
  @IsBoolean()
  isGrandfathered?: boolean;
}
