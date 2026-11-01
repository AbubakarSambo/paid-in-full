import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ProvisionReservedAccountDto {
  @ApiPropertyOptional({ description: 'Defaults to the workspace name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountName?: string;

  @ApiPropertyOptional({ description: 'Monnify contract code; defaults to the workspace/platform contract' })
  @IsOptional()
  @IsString()
  contractCode?: string;

  @ApiPropertyOptional({ enum: ['NGN'], default: 'NGN' })
  @IsOptional()
  @IsIn(['NGN'])
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiPropertyOptional({ description: '11-digit BVN (BVN or NIN is required)' })
  @IsOptional()
  @Matches(/^\d{11}$/, { message: 'BVN must be 11 digits' })
  bvn?: string;

  @ApiPropertyOptional({ description: '11-digit NIN (BVN or NIN is required)' })
  @IsOptional()
  @Matches(/^\d{11}$/, { message: 'NIN must be 11 digits' })
  nin?: string;
}

export class LinkReservedAccountDto {
  @ApiProperty({ description: 'Monnify reserved account reference' })
  @IsString()
  @IsNotEmpty()
  accountReference: string;

  @ApiPropertyOptional({ description: 'NUBAN; verified against the reserved account' })
  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'Account number must be 10 digits' })
  accountNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountName?: string;
}

export class RenameReservedAccountDto {
  @ApiPropertyOptional({ description: 'Defaults to the workspace name ("Rename to workspace")' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountName?: string;
}
