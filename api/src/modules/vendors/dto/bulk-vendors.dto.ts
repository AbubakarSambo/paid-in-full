import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class BulkVendorCsvDto {
  @ApiProperty({
    description: 'CSV text: name,bank,account_number,contact_name,phone,tin,tags (tags separated by ;)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2_000_000)
  csv: string;
}

export type BulkRowStatus = 'ready' | 'mismatch' | 'unverified' | 'invalid' | 'duplicate';

export interface BulkVendorPreviewRow {
  row: number;
  status: BulkRowStatus;
  importable: boolean;
  name: string;
  bankInput: string;
  bankCode: string | null;
  bankName: string | null;
  accountNumber: string;
  contactName: string | null;
  phone: string | null;
  tin: string | null;
  tags: string[];
  /** Name returned by the bank (name enquiry), if any. */
  bankAccountName: string | null;
  reason: string;
}
