import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class DisburseLineDto {
  @ApiProperty()
  @IsUUID()
  itemId: string;

  @ApiPropertyOptional({ description: 'Gross amount to pay on this line now; defaults to its outstanding' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;
}

export class DisbursePreviewDto {
  @ApiProperty({ type: [DisburseLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DisburseLineDto)
  lines: DisburseLineDto[];

  @ApiPropertyOptional({ description: 'Pay as one transfer per vendor (aggregate a vendor\'s lines)' })
  @IsOptional()
  @IsBoolean()
  aggregateByVendor?: boolean;
}

export class DisburseBatchDto extends DisbursePreviewDto {
  @ApiProperty({ description: 'Client-generated UUID. Retrying with the same id resumes/recovers instead of paying again.' })
  @IsUUID()
  clientRequestId: string;

  @ApiProperty({ description: 'The total typed by the payer; must equal the computed total exactly' })
  @IsNumber({ maxDecimalPlaces: 2 })
  typedTotal: number;

  @ApiProperty({ description: 'Disbursement PIN (4–8 digits)' })
  @Matches(/^\d{4,8}$/)
  pin: string;

  @ApiPropertyOptional({ description: 'Account password; required when require_reauth_for_disbursement is on' })
  @IsOptional()
  @IsString()
  password?: string;
}
