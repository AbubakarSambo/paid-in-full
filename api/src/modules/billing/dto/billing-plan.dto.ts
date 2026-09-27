import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { PlanTier } from '@prisma/client';

export class CreateBillingPlanDto {
  @ApiProperty({ enum: PlanTier })
  @IsEnum(PlanTier)
  tier: PlanTier;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Monthly price in NGN — 0 for STARTER/free, negotiated value for ENTERPRISE' })
  @IsNumber()
  @Min(0)
  priceMonthly: number;

  @ApiProperty({ description: 'Arbitrary feature flags/limits shown on the marketing site', type: Object })
  @IsObject()
  features: Record<string, unknown>;
}

export class UpdateBillingPlanDto extends PartialType(CreateBillingPlanDto) {}

export class UpgradeSubscriptionDto {
  @ApiProperty({ enum: PlanTier })
  @IsEnum(PlanTier)
  planTier: PlanTier;
}

export class ChargeSubscriptionDto {
  @ApiProperty({ description: 'Idempotency key — a retried charge request must never double-bill' })
  @IsString()
  @IsNotEmpty()
  clientRequestId: string;

  @ApiPropertyOptional({ description: 'Card authorization/token from a prior Monnify card tokenization step, if applicable' })
  @IsOptional()
  @IsString()
  cardToken?: string;
}
