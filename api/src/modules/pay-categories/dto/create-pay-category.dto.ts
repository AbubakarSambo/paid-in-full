import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePayCategoryDto {
  @ApiProperty({ example: 'Marketing' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ example: 'MKT' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;
}
