import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { ListAuditLogDto } from './dto';
import { PlatformAdminGuard } from '../../common';

@ApiTags('Platform')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('platform/audit-log')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: 'Paginated platform audit log, filterable by workspace/action/entityType/date range' })
  async list(@Query() query: ListAuditLogDto) {
    return this.auditLogService.list(query);
  }
}
