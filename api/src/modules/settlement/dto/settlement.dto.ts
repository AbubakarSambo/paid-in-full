import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsNotEmpty, IsNumber, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSettlementBatchDto {
  @ApiProperty({ description: 'The platform Batch this settlement report reconciles against' })
  @IsString()
  @IsNotEmpty()
  batchId: string;

  @ApiProperty({ required: false })
  @IsString()
  monnifySettlementRef?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  expectedAmount: number;
}

export class SettlementBatchItemInputDto {
  @ApiProperty({ description: "The BatchItemPayout's monnifyReference this settlement line item reports on" })
  @IsString()
  @IsNotEmpty()
  batchItemPayoutRef: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount: number;
}

export class CreateSettlementBatchItemsDto {
  @ApiProperty({ type: [SettlementBatchItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SettlementBatchItemInputDto)
  items: SettlementBatchItemInputDto[];
}
