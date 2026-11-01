import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreatePayCategoryDto } from './create-pay-category.dto';

export class UpdatePayCategoryDto extends PartialType(CreatePayCategoryDto) {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
