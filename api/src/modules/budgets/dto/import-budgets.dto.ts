import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ImportBudgetsDto {
  @ApiProperty({
    description:
      'Raw CSV text with columns payCategory,costCenter,period(YYYY-MM),amount. A header row is optional and auto-detected.',
    example: 'payCategory,costCenter,period,amount\nMarketing,HQ,2024-01,500000',
  })
  @IsString()
  @MinLength(1)
  csv: string;
}
