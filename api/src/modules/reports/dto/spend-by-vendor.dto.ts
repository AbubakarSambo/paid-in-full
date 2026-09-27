import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DateRangeDto } from '../../../common';

export class SpendByVendorQueryDto extends DateRangeDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100, description: 'Top-N vendors to return' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}
