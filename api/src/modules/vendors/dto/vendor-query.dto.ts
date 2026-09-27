import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common';

export class VendorQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Search by vendor name (case-insensitive contains)' })
  @IsOptional()
  @IsString()
  search?: string;
}
