import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomerSubscriptionsService } from './customer-subscriptions.service';
import { CreateCustomerSubscriptionDto, UpdateCustomerSubscriptionDto } from './dto';
import { CurrentUser, CurrentUserData, PaginationDto, Roles, Role } from '../../common';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('customer-subscriptions')
export class CustomerSubscriptionsController {
  constructor(private readonly customerSubscriptionsService: CustomerSubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: "List the workspace's customer subscriptions" })
  findAll(@CurrentUser() user: CurrentUserData, @Query() pagination: PaginationDto) {
    return this.customerSubscriptionsService.findAll(user.workspaceId, pagination);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single customer subscription' })
  findOne(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.customerSubscriptionsService.findOne(user.workspaceId, id);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.POSTER)
  @Post()
  @ApiOperation({ summary: 'Create a recurring billing subscription for a customer' })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateCustomerSubscriptionDto) {
    return this.customerSubscriptionsService.create(user.workspaceId, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.POSTER)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a customer subscription' })
  update(@CurrentUser() user: CurrentUserData, @Param('id') id: string, @Body() dto: UpdateCustomerSubscriptionDto) {
    return this.customerSubscriptionsService.update(user.workspaceId, id, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a customer subscription' })
  remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.customerSubscriptionsService.remove(user.workspaceId, id);
  }
}
