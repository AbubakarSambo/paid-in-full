import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { IsDateString, IsNumber, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { ChargeSubscriptionDto, MonnifyWebhookDto, UpgradeSubscriptionDto } from './dto';
import { CurrentUser, CurrentUserData, Public, Capability, RequireCapability } from '../../common';

class ProvisionBillingAccountDto {
  @IsOptional()
  @Matches(/^\d{11}$/, { message: 'BVN must be 11 digits.' })
  bvn?: string;

  @IsOptional()
  @Matches(/^\d{11}$/, { message: 'NIN must be 11 digits.' })
  nin?: string;
}

class RecordPifPaymentDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  @MinLength(3)
  reference: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @ApiBearerAuth()
  @RequireCapability(Capability.VIEW)
  @Get('subscription')
  @ApiOperation({ summary: "Get the current workspace's subscription + plan" })
  getSubscription(@CurrentUser() user: CurrentUserData) {
    return this.billingService.getSubscription(user.workspaceId);
  }

  @ApiBearerAuth()
  @RequireCapability(Capability.ADMIN)
  @Post('subscription/upgrade')
  @ApiOperation({ summary: 'Create/upgrade the workspace subscription to a plan tier' })
  upgrade(@CurrentUser() user: CurrentUserData, @Body() dto: UpgradeSubscriptionDto) {
    return this.billingService.upgrade(user.workspaceId, dto);
  }

  @ApiBearerAuth()
  @RequireCapability(Capability.ADMIN)
  @Post('subscription/charge')
  @ApiOperation({ summary: 'Initiate the recurring card charge for the current billing period (idempotent)' })
  charge(@CurrentUser() user: CurrentUserData, @Body() dto: ChargeSubscriptionDto) {
    return this.billingService.chargeSubscription(user.workspaceId, dto);
  }

  // ─── PIF's own subscription (spec §5.10 #17) ───

  @ApiBearerAuth()
  @RequireCapability(Capability.VIEW)
  @Get('pif-subscription')
  @ApiOperation({ summary: 'Your Paid in Full subscription: tier, amount, next due, paid-up-to, billing NUBAN, payment history' })
  getPifSubscription(@CurrentUser() user: CurrentUserData) {
    return this.billingService.getPifSubscription(user.workspaceId);
  }

  @ApiBearerAuth()
  @RequireCapability(Capability.ADMIN)
  @Post('pif-subscription/account')
  @ApiOperation({ summary: 'Create the dedicated billing NUBAN (BVN or NIN required)' })
  provisionAccount(@CurrentUser() user: CurrentUserData, @Body() dto: ProvisionBillingAccountDto) {
    return this.billingService.provisionPifBillingAccount(user.workspaceId, user.id, dto);
  }

  @ApiBearerAuth()
  @RequireCapability(Capability.SUPER_ADMIN)
  @Post('pif-subscription/:workspaceId/payments')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record a PIF fee payment for a client (super admin); extends paid-until' })
  recordPifPayment(@CurrentUser() user: CurrentUserData, @Param('workspaceId') workspaceId: string, @Body() dto: RecordPifPaymentDto) {
    return this.billingService.recordPifPayment(workspaceId, dto.amount, dto.reference, dto.paidAt ? new Date(dto.paidAt) : new Date(), user.id);
  }

  @Public()
  @Post('webhook')
  @ApiOperation({ summary: 'Monnify billing webhook (public, unauthenticated — signature verification unconfirmed, see MonnifyWebhookDto)' })
  webhook(@Body() dto: MonnifyWebhookDto) {
    return this.billingService.handleWebhook(dto);
  }
}
