import { IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SuggestCategoryDto {
  @ApiProperty({ description: 'Free-text vendor invoice / expense description' })
  @IsString()
  @MinLength(1)
  description!: string;

  @ApiPropertyOptional({ description: 'Amount of the expense, for extra context' })
  @IsOptional()
  @IsNumber()
  amount?: number;
}

export interface SuggestCategoryResult {
  suggestedCategoryName: string;
  confidence: 'high' | 'low';
  isNewCategory: boolean;
}
