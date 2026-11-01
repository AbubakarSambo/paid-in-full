import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class InvoiceItemDto {
  @ApiPropertyOptional({ description: 'Catalog product; fills description/unit price/VAT when those are omitted' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ example: 'Consulting services — September' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0.01)
  quantity: number;

  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({ example: 7.5, description: 'VAT percent; defaults to 7.5 when the workspace VAT setting is on' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  vatRate?: number;

  @ApiPropertyOptional({ example: 5, description: 'WHT percent deducted by the customer' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  whtRate?: number;
}
