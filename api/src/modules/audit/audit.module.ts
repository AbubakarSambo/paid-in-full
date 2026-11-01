import { Global, Module } from '@nestjs/common';
import { AuditLogService } from '../platform/audit-log.service';

/** Global: AuditLogService is injectable in every module without an import. */
@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
