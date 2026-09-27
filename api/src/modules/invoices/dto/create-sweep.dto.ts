import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSweepDto {
  @ApiPropertyOptional({ description: 'Row reference in the reconciliation Google Sheet' })
  @IsOptional()
  @IsString()
  sheetRowReference?: string;

  @ApiProperty({ example: 50000 })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  amount: number;
}
