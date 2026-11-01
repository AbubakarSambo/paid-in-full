import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { SentryModule } from '@sentry/nestjs/setup';
import { ConfigModule } from './config';
import { PrismaModule } from './modules/prisma';
import { AuditModule } from './modules/audit';
import { AuthModule } from './modules/auth';
import { UsersModule } from './modules/users';
import { WorkspacesModule } from './modules/workspaces';
import { VendorsModule } from './modules/vendors/vendors.module';
import { MonnifyModule } from './modules/monnify/monnify.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { WhtModule } from './modules/wht/wht.module';
import { RequisitionsModule } from './modules/requisitions/requisitions.module';
import { QueueModule } from './modules/queue/queue.module';
import { BatchesModule } from './modules/batches/batches.module';
import { CostCentersModule } from './modules/cost-centers/cost-centers.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { LocationsModule } from './modules/locations/locations.module';
import { PayCategoriesModule } from './modules/pay-categories/pay-categories.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { RecurringModule } from './modules/recurring/recurring.module';
import { CustomersModule } from './modules/customers/customers.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { ProductsModule } from './modules/products/products.module';
import { BillingModule } from './modules/billing/billing.module';
import { SettlementModule } from './modules/settlement/settlement.module';
import { EmailModule } from './modules/email/email.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SheetsModule } from './modules/sheets/sheets.module';
import { AiModule } from './modules/ai/ai.module';
import { CoaTagsModule } from './modules/coa-tags/coa-tags.module';
import { StockModule } from './modules/stock/stock.module';
import { PlatformModule } from './modules/platform/platform.module';
import { AppConfigModule } from './modules/app-config/app-config.module';
import { SecurityModule } from './modules/security/security.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';
import { DebugController } from './common/debug/debug.controller';
import {
  JwtAuthGuard,
  RolesGuard,
  CapabilityGuard,
  PlanGuard,
  GlobalExceptionFilter,
  TransformInterceptor,
  LoggingInterceptor,
  SubscriptionReadOnlyGuard,
} from './common';

@Module({
  imports: [
    // Must be first — wires up Sentry's request-lifecycle instrumentation (no-ops if
    // instrument.ts didn't call Sentry.init(), i.e. SENTRY_DSN isn't set).
    SentryModule.forRoot(),
    ConfigModule,
    ThrottlerModule.forRoot([{ name: 'global', ttl: 60000, limit: 60 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    EmailModule,
    AuthModule,
    UsersModule,
    WorkspacesModule,
    VendorsModule,
    MonnifyModule,
    WalletModule,
    WhtModule,
    RequisitionsModule,
    QueueModule,
    BatchesModule,
    CostCentersModule,
    DepartmentsModule,
    LocationsModule,
    PayCategoriesModule,
    BudgetsModule,
    RecurringModule,
    CustomersModule,
    InvoicesModule,
    ProductsModule,
    BillingModule,
    SettlementModule,
    NotificationsModule,
    ReportsModule,
    SheetsModule,
    AiModule,
    CoaTagsModule,
    StockModule,
    PlatformModule,
    AppConfigModule,
    SecurityModule,
    OnboardingModule,
    SuperAdminModule,
  ],
  controllers: [DebugController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // Global capability guard: no-ops unless a route is annotated with @RequireCapability(...)
    {
      provide: APP_GUARD,
      useClass: CapabilityGuard,
    },
    // Global Plan Guard — no-ops unless a route is annotated with @RequiresPlan(...)
    {
      provide: APP_GUARD,
      useClass: PlanGuard,
    },
    {
      provide: APP_GUARD,
      useClass: SubscriptionReadOnlyGuard,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
