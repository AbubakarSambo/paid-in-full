import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';
import { CreateRecurringPaymentDto, UpdateRecurringPaymentDto } from './dto';
import { RecurringService } from './recurring.service';

@ApiTags('Queue')
@ApiBearerAuth()
@Controller('recurring')
export class RecurringController {
  constructor(private readonly recurring: RecurringService) {}

  @Get()
  @ApiOperation({ summary: 'List recurring payments (with next due date)' })
  list(@CurrentUser('workspaceId') workspaceId: string) {
    return this.recurring.list(workspaceId);
  }

  @Post('run')
  @RequireCapability(Capability.POST)
  @ApiOperation({ summary: 'Enqueue due recurring payments now (run_recurring_payments)' })
  run(@CurrentUser() user: CurrentUserData) {
    return this.recurring.run(user.workspaceId, user, user.id);
  }

  @Post()
  @RequireCapability(Capability.POST)
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateRecurringPaymentDto) {
    return this.recurring.create(user.workspaceId, user.id, dto);
  }

  @Patch(':id')
  @RequireCapability(Capability.POST)
  update(
    @CurrentUser('workspaceId') workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringPaymentDto,
  ) {
    return this.recurring.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @RequireCapability(Capability.POST)
  remove(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.recurring.remove(workspaceId, id);
  }
}
