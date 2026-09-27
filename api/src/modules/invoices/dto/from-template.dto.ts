import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsUUID } from 'class-validator';

export class FromTemplateDto {
  @ApiProperty({ example: 'uuid-of-customer' })
  @IsNotEmpty()
  @IsUUID()
  customerId: string;

  @ApiProperty({ example: '2026-09-27' })
  @IsNotEmpty()
  @Type(() => Date)
  @IsDate()
  issueDate: Date;
}
