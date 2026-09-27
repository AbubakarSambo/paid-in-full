import { Module, Global } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import {
  appConfig,
  databaseConfig,
  jwtConfig,
  resendConfig,
  monnifyConfig,
  googleConfig,
  googleSheetsConfig,
  whatsappConfig,
  aiConfig,
  pushConfig,
} from './configuration';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        jwtConfig,
        resendConfig,
        monnifyConfig,
        googleConfig,
        googleSheetsConfig,
        whatsappConfig,
        aiConfig,
        pushConfig,
      ],
      envFilePath: ['.env.local', '.env'],
    }),
  ],
})
export class ConfigModule {}
