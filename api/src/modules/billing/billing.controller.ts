import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { ChargeSubscriptionDto, MonnifyWebhookDto, UpgradeSubscriptionDto } from './dto';
import { CurrentUser, CurrentUserData, Public, Roles, Role } from '../../common';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @ApiBearerAuth()
  @Get('subscription')
  @ApiOperation({ summary: "Get the current workspace's subscription + plan" })
  getSubscription(@CurrentUser() user: CurrentUserData) {
    return this.billingService.getSubscription(user.workspaceId);
  }

  @ApiBearerAuth()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Post('subscription/upgrade')
  @ApiOperation({ summary: 'Create/upgrade the workspace subscription to a plan tier' })
  upgrade(@CurrentUser() user: CurrentUserData, @Body() dto: UpgradeSubscriptionDto) {
    return this.billingService.upgrade(user.workspaceId, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Post('subscription/charge')
  @ApiOperation({ summary: 'Initiate the recurring card charge for the current billing period (idempotent)' })
  charge(@CurrentUser() user: CurrentUserData, @Body() dto: ChargeSubscriptionDto) {
    return this.billingService.chargeSubscription(user.workspaceId, dto);
  }

  @Public()
  @Post('webhook')
  @ApiOperation({ summary: 'Monnify billing webhook (public, unauthenticated — signature verification unconfirmed, see MonnifyWebhookDto)' })
  webhook(@Body() dto: MonnifyWebhookDto) {
    return this.billingService.handleWebhook(dto);
  }
}
