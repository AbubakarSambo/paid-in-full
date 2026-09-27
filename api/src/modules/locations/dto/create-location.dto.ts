import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLocationDto {
  @ApiProperty({ example: 'Ikeja Property' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ example: '12 Allen Avenue, Ikeja, Lagos' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
}
