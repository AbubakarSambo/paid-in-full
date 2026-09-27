import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ParseExpenseDto {
  @ApiProperty({ description: 'Pasted freeform expense note, e.g. a WhatsApp message about a purchase' })
  @IsString()
  @MinLength(1)
  freeText!: string;
}

export interface ParsedExpenseResult {
  vendorName: string | null;
  amount: number | null;
  description: string | null;
  invoiceDate: string | null;
}
