import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
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

export class StatementPreviewDto {
  @ApiProperty({ description: 'Raw bank statement CSV text. Columns are auto-detected (date, narration, debit, reference).' })
  @IsString()
  @IsNotEmpty()
  csv: string;
}

export class StatementMatchDto {
  @ApiProperty()
  @IsUUID()
  batchItemId: string;

  @ApiProperty({ description: 'Gross amount to record as paid on the line' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  debit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  statementDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  statementReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Statement row number (keeps STMT- references unique per row)' })
  @IsOptional()
  @IsNumber()
  row?: number;
}

export class ConfirmStatementMatchesDto {
  @ApiProperty({ type: [StatementMatchDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StatementMatchDto)
  matches: StatementMatchDto[];
}
