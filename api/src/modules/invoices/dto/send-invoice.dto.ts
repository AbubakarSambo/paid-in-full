import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type InvoiceSendChannel = 'EMAIL' | 'WHATSAPP';

export class SendInvoiceDto {
  @ApiPropertyOptional({ enum: ['EMAIL', 'WHATSAPP'], default: 'EMAIL' })
  @IsOptional()
  @IsIn(['EMAIL', 'WHATSAPP'])
  channel?: InvoiceSendChannel;

  @ApiPropertyOptional({ description: 'Email address or WhatsApp phone; defaults to the customer email/phone' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipient?: string;

  @ApiPropertyOptional({ type: [String], description: 'Email CC addresses' })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  cc?: string[];

  @ApiPropertyOptional({ description: 'Custom WhatsApp message (the share link is appended)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
