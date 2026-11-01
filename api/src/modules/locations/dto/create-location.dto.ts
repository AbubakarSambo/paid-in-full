import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

/** BU Head (child of a Business Unit). */
export class CreateLocationDto {
  @ApiProperty({ example: 'Site 1' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiProperty({ description: 'Parent business unit' })
  @IsUUID()
  costCenterId: string;

  @ApiPropertyOptional({ description: 'The "✦ General (split)" option', default: false })
  @IsOptional()
  @IsBoolean()
  isGeneral?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
}
