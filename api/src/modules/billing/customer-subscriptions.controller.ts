import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CustomerSubscriptionsService } from './customer-subscriptions.service';
import {
  AuthoriseMandateDto,
  ChargeNowDto,
  CreateCustomerSubscriptionDto,
  SubscriptionFilterDto,
  UpdateCustomerSubscriptionDto,
} from './dto';
import { CurrentUser, CurrentUserData, Capability, RequireCapability, Public } from '../../common';

@ApiTags('Client Subscriptions')
@ApiBearerAuth()
@RequireCapability(Capability.INVOICE)
@Controller('customer-subscriptions')
export class CustomerSubscriptionsController {
  constructor(private readonly subs: CustomerSubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'Client subscriptions (filter by status)' })
  findAll(@CurrentUser('workspaceId') workspaceId: string, @Query() filter: SubscriptionFilterDto) {
    return this.subs.findAll(workspaceId, filter);
  }

  @Get('mandates')
  @ApiOperation({ summary: 'Client mandates (authorised auto-debits) with their latest charges' })
  mandates(@CurrentUser('workspaceId') workspaceId: string) {
    return this.subs.listMandates(workspaceId);
  }

  @Get('charges')
  @ApiOperation({ summary: 'Recent mandate charges' })
  charges(@CurrentUser('workspaceId') workspaceId: string, @Query('limit') limit?: string) {
    return this.subs.recentCharges(workspaceId, limit ? Number(limit) || 50 : 50);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a client subscription with its charges' })
  findOne(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.subs.findOne(workspaceId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a plan (client, plan name, amount, frequency, description); returns the authorisation link' })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateCustomerSubscriptionDto) {
    return this.subs.create(user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a plan' })
  update(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerSubscriptionDto) {
    return this.subs.update(user, id, dto);
  }

  @Post(':id/authorisation-link')
  @ApiOperation({ summary: 'Generate the /m/:token authorisation link (?regenerate=true rotates it)' })
  link(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Query('regenerate') regenerate?: string) {
    return this.subs.authorisationLink(user, id, regenerate === 'true');
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel the plan (revokes any mandate)' })
  cancel(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.subs.cancel(user, id);
  }

  @Post(':id/cancel-mandate')
  @ApiOperation({ summary: 'Cancel the mandate' })
  cancelMandate(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.subs.cancelMandate(user, id);
  }

  @Post(':id/charge')
  @ApiOperation({ summary: 'Charge the mandate now (amount defaults to the plan amount)' })
  charge(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChargeNowDto) {
    return this.subs.chargeNow(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a never-charged, non-active plan' })
  remove(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.subs.remove(user, id);
  }
}

/** Public mandate authorisation for /m/:token. */
@ApiTags('Public')
@Public()
@Controller('public/mandates')
export class PublicMandatesController {
  constructor(private readonly subs: CustomerSubscriptionsService) {}

  @Get(':token')
  @Throttle({ global: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: 'Mandate authorisation page data (plan, amount, frequency, merchant, status)' })
  page(@Param('token') token: string) {
    return this.subs.getMandatePage(token);
  }

  @Post(':token/authorise')
  @Throttle({ global: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Authorise: CARD returns a Monnify checkout URL (₦50 verification); DIRECT_DEBIT takes bank, NUBAN, phone, address' })
  authorise(@Param('token') token: string, @Body() dto: AuthoriseMandateDto) {
    return this.subs.authorise(token, dto);
  }
}
