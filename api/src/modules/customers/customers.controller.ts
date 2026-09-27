import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  CustomerFilterDto,
  CreateCustomerCreditDto,
} from './dto';
import { CurrentUser, CurrentUserData, Role, Roles } from '../../common';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'List customers (paginated, searchable)' })
  findAll(@CurrentUser('workspaceId') workspaceId: string, @Query() filter: CustomerFilterDto) {
    return this.customersService.findAll(workspaceId, filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a customer by id' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    return this.customersService.findOne(id, workspaceId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a customer' })
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: CurrentUserData) {
    return this.customersService.create(user.workspaceId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a customer' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.customersService.update(id, workspaceId, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete a customer' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    return this.customersService.remove(id, workspaceId);
  }

  @Get(':id/credits')
  @ApiOperation({ summary: 'List a customer credit notes' })
  listCredits(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.customersService.listCredits(id, workspaceId);
  }

  @Post(':id/credits')
  @ApiOperation({ summary: 'Issue a credit note to a customer' })
  addCredit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCustomerCreditDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.customersService.addCredit(id, workspaceId, dto);
  }
}
