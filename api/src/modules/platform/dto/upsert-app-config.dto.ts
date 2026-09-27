import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpsertAppConfigDto {
  @ApiProperty({ description: 'Config key' })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({ description: 'Config value (any JSON-serializable value)' })
  value: any;
}
