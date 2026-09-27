import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CleanDescriptionDto {
  @ApiProperty({ description: 'Messy free-text vendor invoice description' })
  @IsString()
  @MinLength(1)
  rawDescription!: string;
}

export interface CleanDescriptionResult {
  cleaned: string;
}
