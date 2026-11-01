import { Global, Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';
import { AppConfigController } from './app-config.controller';

/** Global: AppConfigService (per-workspace settings) is injectable everywhere. */
@Global()
@Module({
  controllers: [AppConfigController],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
