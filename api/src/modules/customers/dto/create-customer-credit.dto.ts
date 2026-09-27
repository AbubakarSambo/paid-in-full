import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateCustomerCreditDto {
  @ApiProperty({ example: 5000, description: 'Credit amount' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ example: 'Refund for cancelled order' })
  @IsOptional()
  @IsString()
  reason?: string;
}
