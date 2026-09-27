import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export type InvoiceSendChannel = 'EMAIL' | 'WHATSAPP' | 'SMS';

export class SendInvoiceDto {
  @ApiProperty({ enum: ['EMAIL', 'WHATSAPP', 'SMS'] })
  @IsNotEmpty()
  @IsIn(['EMAIL', 'WHATSAPP', 'SMS'])
  channel: InvoiceSendChannel;

  @ApiProperty({ example: 'customer@example.com or +2348012345678' })
  @IsNotEmpty()
  @IsString()
  recipient: string;
}
