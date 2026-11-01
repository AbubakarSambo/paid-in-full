import { Global, Module } from '@nestjs/common';
import { SecurityService } from './security.service';
import { SecurityController } from './security.controller';

/** Global: SecurityService (verifyPin / verifyPassword / assertDisbursementAuth) injectable anywhere. */
@Global()
@Module({
  controllers: [SecurityController],
  providers: [SecurityService],
  exports: [SecurityService],
})
export class SecurityModule {}
