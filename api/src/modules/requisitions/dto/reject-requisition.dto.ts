import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RejectRequisitionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  rejectionReason: string;
}
