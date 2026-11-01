import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto, CustomerFilterDto, CreateCustomerCreditDto, MergeCustomerDto, CreditFilterDto } from './dto';
import { CurrentUser, CurrentUserData, Capability, RequireCapability } from '../../common';

@ApiTags('Customers')
@ApiBearerAuth()
@RequireCapability(Capability.INVOICE)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'List customers (status=active|archived|all, search) with outstanding + open credit' })
  findAll(@CurrentUser('workspaceId') workspaceId: string, @Query() filter: CustomerFilterDto) {
    return this.customersService.findAll(workspaceId, filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a customer with invoices, credits and subscriptions' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    return this.customersService.findOne(id, workspaceId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a customer (name, email, phone, address, taxId, notes)' })
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: CurrentUserData) {
    return this.customersService.create(user.workspaceId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a customer' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto, @CurrentUser('workspaceId') workspaceId: string) {
    return this.customersService.update(id, workspaceId, dto);
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Archive a customer' })
  archive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.setArchived(user, id, true);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Restore an archived customer' })
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.setArchived(user, id, false);
  }

  @Post(':id/merge')
  @ApiOperation({ summary: 'Merge a duplicate (mergeId) into this customer: moves invoices, credits, subscriptions' })
  merge(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MergeCustomerDto, @CurrentUser() user: CurrentUserData) {
    return this.customersService.merge(user, id, dto.mergeId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a customer (409 if it has invoices)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.remove(user, id);
  }

  @Get(':id/credits')
  @ApiOperation({ summary: "List a customer's credits" })
  listCredits(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    return this.customersService.listCredits(id, workspaceId);
  }

  @Post(':id/credits')
  @ApiOperation({ summary: 'Issue a manual credit to a customer' })
  addCredit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCustomerCreditDto, @CurrentUser() user: CurrentUserData) {
    return this.customersService.addCredit(user, id, dto);
  }
}

@ApiTags('Customers')
@ApiBearerAuth()
@RequireCapability(Capability.INVOICE)
@Controller('customer-credits')
export class CustomerCreditsController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'Credits tab: all customer credits (filter status/customer) + open total' })
  list(@CurrentUser('workspaceId') workspaceId: string, @Query() filter: CreditFilterDto) {
    return this.customersService.listAllCredits(workspaceId, filter);
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Mark an open credit as refunded' })
  refund(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.refundCredit(user, id);
  }
}
