import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Clear / return / reject / submit / undo. */
export class ReviewRequisitionDto {
  @ApiPropertyOptional({ description: 'Note to requester / procurement (required to return or reject)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewNote?: string;

  @ApiPropertyOptional({ description: 'Apply to every requisition in the same bundle' })
  @IsOptional()
  @IsBoolean()
  wholeBundle?: boolean;
}
