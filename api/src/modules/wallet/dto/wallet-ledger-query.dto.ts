import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional } from 'class-validator';
import { LedgerDirection, LedgerStatus, WalletTransactionType } from '@prisma/client';
import { PaginationDto } from '../../../common';

export class WalletLedgerQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: WalletTransactionType })
  @IsOptional()
  @IsEnum(WalletTransactionType)
  type?: WalletTransactionType;

  @ApiPropertyOptional({ enum: LedgerDirection })
  @IsOptional()
  @IsEnum(LedgerDirection)
  direction?: LedgerDirection;

  @ApiPropertyOptional({ enum: LedgerStatus })
  @IsOptional()
  @IsEnum(LedgerStatus)
  status?: LedgerStatus;

  @ApiPropertyOptional({ description: 'Start date for filtering' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @ApiPropertyOptional({ description: 'End date for filtering' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;
}
