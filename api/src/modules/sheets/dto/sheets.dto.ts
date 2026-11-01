import { Equals, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveSheetsConfigDto {
  @ApiPropertyOptional({ description: 'Batches sheet: Google Sheets URL or Apps Script /exec URL ("" clears)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sheetsUrl?: string;

  @ApiPropertyOptional({ default: 'BATCHES' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchesTabName?: string;

  @ApiPropertyOptional({ description: 'Reconciliation (mastersheet) Google Sheets URL; needed when sheetsUrl is Apps Script' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reconSheetUrl?: string;

  @ApiPropertyOptional({ description: 'Invoices sheet: Google Sheets URL or Apps Script /exec URL' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  invoicesSheetsUrl?: string;

  @ApiPropertyOptional({ default: 'INVOICES' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoicesTabName?: string;
}

export class TestSheetsDto {
  @ApiPropertyOptional({ enum: ['batches', 'invoices'], default: 'batches' })
  @IsOptional()
  @IsIn(['batches', 'invoices'])
  target?: 'batches' | 'invoices';
}

export class BackfillSheetsDto {
  @ApiProperty({ example: '2026-01-01', description: 'Push unsynced batches dated on/after this day' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from!: string;
}

export class WipeRepushDto {
  @ApiProperty({ description: 'Must be true: this rewrites every row in the BATCHES tab' })
  @IsBoolean()
  @Equals(true, { message: 'Set confirm: true to wipe and repush the sheet' })
  confirm!: boolean;
}
