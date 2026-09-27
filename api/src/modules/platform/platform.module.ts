import { Module } from '@nestjs/common';
import { PlatformWorkspacesController } from './workspaces.controller';
import { PlatformWorkspacesService } from './workspaces.service';
import { AppConfigAdminController } from './app-config.controller';
import { AppConfigAdminService } from './app-config.service';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { ClientErrorsController } from './client-errors.controller';
import { ClientErrorsService } from './client-errors.service';

@Module({
  controllers: [
    PlatformWorkspacesController,
    AppConfigAdminController,
    AuditLogController,
    ClientErrorsController,
  ],
  providers: [
    PlatformWorkspacesService,
    AppConfigAdminService,
    AuditLogService,
    ClientErrorsService,
  ],
  exports: [AuditLogService],
})
export class PlatformModule {}
