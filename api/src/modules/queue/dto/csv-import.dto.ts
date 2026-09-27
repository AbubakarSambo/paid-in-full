import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

// Raw CSV text, columns: vendorName,description,amount,payCategory,invoiceNumber,invoiceDate
export class CsvImportDto {
  @ApiProperty({ description: 'Raw CSV text with header row: vendorName,description,amount,payCategory,invoiceNumber,invoiceDate' })
  @IsString()
  csv: string;
}
