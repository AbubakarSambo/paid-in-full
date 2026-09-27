import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpsertWhtRateDto {
  @ApiProperty({ minimum: 0, maximum: 100, description: 'Withholding tax rate as a percentage' })
  @IsNumber()
  @Min(0)
  @Max(100)
  ratePercent: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
