import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

export class ApplyCreditDto {
  @ApiProperty()
  @IsUUID()
  creditId: string;
}

export class SaveAsTemplateDto {
  @ApiProperty({ example: 'Monthly retainer' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  name: string;
}

export class ConvertQuoteDto {
  @ApiPropertyOptional({ description: 'Issue the new invoice immediately (default: keep as draft)' })
  @IsOptional()
  @IsBoolean()
  issue?: boolean;
}

export class DeleteInvoiceQueryDto {
  @ApiPropertyOptional({ description: 'Confirm deleting an invoice that has payments recorded' })
  @IsOptional()
  @Type(() => String)
  force?: string;
}

export class SimulateCollectionDto {
  @ApiProperty({ example: 25000 })
  @IsNumber()
  @Min(1)
  amount: number;
}

export class PaymentAccountDto {
  @ApiProperty({ example: '058' })
  @IsString()
  @Matches(/^\d{3,6}$/, { message: 'bankCode must be a Monnify bank code' })
  bankCode: string;

  @ApiProperty({ example: '0123456789' })
  @Matches(/^\d{10}$/, { message: 'accountNumber must be a 10-digit NUBAN' })
  accountNumber: string;
}

export class SweepSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: '058' })
  @IsOptional()
  @Matches(/^\d{3,6}$/)
  bankCode?: string;

  @ApiPropertyOptional({ example: '0123456789' })
  @IsOptional()
  @Matches(/^\d{10}$/)
  accountNumber?: string;

  @ApiPropertyOptional({ description: 'Overrides the name returned by bank name enquiry' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountName?: string;

  @ApiPropertyOptional({ example: 1000, description: 'Amount kept back from each payment' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  buffer?: number;
}

export class InvoiceSettingsDto {
  @ApiPropertyOptional({ description: 'Logo URL or data URL' })
  @IsOptional()
  @IsString()
  @MaxLength(3_000_000)
  logoUrl?: string | null;

  @ApiPropertyOptional({ description: 'Signature image URL or data URL' })
  @IsOptional()
  @IsString()
  @MaxLength(3_000_000)
  signatureUrl?: string | null;

  @ApiPropertyOptional({ example: 'F4B942' })
  @IsOptional()
  @Matches(/^#?[0-9a-fA-F]{6}$/, { message: 'themeColor must be a 6-digit hex colour' })
  themeColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  footerText?: string | null;

  @ApiPropertyOptional({ example: 'INV' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9]{1,10}$/, { message: 'Prefix must be 1-10 letters/digits' })
  invoicePrefix?: string;

  @ApiPropertyOptional({ example: 'QTE' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9]{1,10}$/, { message: 'Prefix must be 1-10 letters/digits' })
  quotePrefix?: string;

  @ApiPropertyOptional({ description: 'VAT 7.5% on new invoice lines by default' })
  @IsOptional()
  @IsBoolean()
  vatOnNewInvoices?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  defaultTerms?: string;
}
