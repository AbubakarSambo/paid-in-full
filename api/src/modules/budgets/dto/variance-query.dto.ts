import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class VarianceQueryDto {
  @ApiProperty({ example: '2024-01', description: 'Month to report on, YYYY-MM' })
  @Matches(PERIOD_PATTERN, { message: 'period must be in YYYY-MM format' })
  period: string;
}
