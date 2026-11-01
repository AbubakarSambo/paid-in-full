import { PartialType } from '@nestjs/swagger';
import { CreateInvoiceDto } from './create-invoice.dto';

/** Draft edits. Every field optional; `items` replaces all lines when present. */
export class UpdateInvoiceDto extends PartialType(CreateInvoiceDto) {}
