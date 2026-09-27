import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingPlansService } from './billing-plans.service';
import { CreateBillingPlanDto, UpdateBillingPlanDto } from './dto';
import { Public, Roles, Role } from '../../common';

@ApiTags('Billing')
@Controller('billing/plans')
export class BillingPlansController {
  constructor(private readonly billingPlansService: BillingPlansService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List billing plans (public — marketing site pricing page)' })
  findAll() {
    return this.billingPlansService.findAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a single billing plan (public)' })
  findOne(@Param('id') id: string) {
    return this.billingPlansService.findOne(id);
  }

  @ApiBearerAuth()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Post()
  @ApiOperation({ summary: 'Create a billing plan (admin only)' })
  create(@Body() dto: CreateBillingPlanDto) {
    return this.billingPlansService.create(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a billing plan (admin only)' })
  update(@Param('id') id: string, @Body() dto: UpdateBillingPlanDto) {
    return this.billingPlansService.update(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a billing plan (admin only)' })
  remove(@Param('id') id: string) {
    return this.billingPlansService.remove(id);
  }
}
