import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';
import { CreateInvoiceRecurrenceDto, UpdateInvoiceRecurrenceDto } from './dto';
import { InvoiceRecurrencesService } from './invoice-recurrences.service';

@ApiTags('Invoice Recurrences')
@ApiBearerAuth()
@RequireCapability(Capability.INVOICE)
@Controller('invoice-recurrences')
export class InvoiceRecurrencesController {
  constructor(private readonly recurrences: InvoiceRecurrencesService) {}

  @Get()
  @ApiOperation({ summary: 'List recurring invoice schedules' })
  findAll(@CurrentUser('workspaceId') workspaceId: string) {
    return this.recurrences.findAll(workspaceId);
  }

  @Post('run')
  @ApiOperation({ summary: 'Generate drafts for review for every schedule due today' })
  runDue(@CurrentUser() user: CurrentUserData) {
    return this.recurrences.runDueForWorkspace(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a recurring schedule with its generated invoices' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    return this.recurrences.findOne(workspaceId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a recurring schedule (cadence weekly/monthly/quarterly/yearly, next run, end, due days, lines)' })
  create(@Body() dto: CreateInvoiceRecurrenceDto, @CurrentUser('workspaceId') workspaceId: string) {
    return this.recurrences.create(workspaceId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a recurring schedule (isActive=false pauses it)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceRecurrenceDto, @CurrentUser('workspaceId') workspaceId: string) {
    return this.recurrences.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a recurring schedule' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    return this.recurrences.remove(workspaceId, id);
  }

  @Post(':id/run')
  @ApiOperation({ summary: 'Generate a draft from this schedule now' })
  runOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserData) {
    return this.recurrences.runOne(user, id);
  }
}
