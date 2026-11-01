import { Module } from '@nestjs/common';
import { PlatformWorkspacesController } from './workspaces.controller';
import { PlatformWorkspacesService } from './workspaces.service';
import { AppConfigAdminController } from './app-config.controller';
import { AppConfigAdminService } from './app-config.service';
import { AuditLogController } from './audit-log.controller';
import { ClientErrorsController } from './client-errors.controller';
import { ClientErrorsService } from './client-errors.service';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

@Module({
  controllers: [
    PlatformWorkspacesController,
    AppConfigAdminController,
    AuditLogController,
    ClientErrorsController,
    ActivityController,
  ],
  providers: [
    PlatformWorkspacesService,
    AppConfigAdminService,
    ClientErrorsService,
    ActivityService,
  ],
  exports: [ActivityService],
})
export class PlatformModule {}
