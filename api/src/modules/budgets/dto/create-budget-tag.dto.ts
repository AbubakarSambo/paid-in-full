import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateBudgetTagDto {
  @ApiProperty({ example: 'Staff Welfare' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ description: 'Budgeted payment category; defaults to the first includeInBudgets category' })
  @IsOptional()
  @IsUUID()
  payCategoryId?: string;
}
