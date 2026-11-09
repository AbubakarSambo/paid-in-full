import './instrument';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    rawBody: true, // For Monnify webhook signature verification
  });

  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api/v1');

  const allowedOrigins = configService.get<string>('app.corsOrigins');
  const staticOrigins = allowedOrigins ? allowedOrigins.split(',') : [];
  const vercelPreviewPattern = /^https:\/\/paid-in-full-[a-z0-9-]+-abubakar-sambos-projects\.vercel\.app$/;

  app.enableCors({
    origin: !allowedOrigins
      ? true
      : (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
          if (!origin || staticOrigins.includes(origin) || vercelPreviewPattern.test(origin)) {
            return callback(null, true);
          }
          // Not allowed: omit the CORS headers (the browser blocks it) instead of throwing a 500.
          callback(null, false);
        },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Paid in Full API')
    .setDescription('Batch vendor disbursement platform for Nigerian operators')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth', 'Authentication endpoints')
    .addTag('Workspaces', 'Workspace settings')
    .addTag('Vendors', 'Vendor directory')
    .addTag('Requisitions', 'Spend requests')
    .addTag('Queue', 'Disbursement queue')
    .addTag('Batches', 'Disbursement batches')
    .addTag('Monnify', 'Payout rail integration')
    .addTag('Wallet', 'Disbursement wallet')
    .addTag('Budgets', 'Budgets & variance')
    .addTag('Reports', 'Spend reports')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('app.port') || 3000;
  await app.listen(port, '0.0.0.0');

  logger.log(`Application running on: http://localhost:${port}`);
  logger.log(`Swagger docs available at: http://localhost:${port}/api/docs`);
}

bootstrap();
