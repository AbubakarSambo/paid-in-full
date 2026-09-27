// Must be imported before any other module in main.ts (Sentry patches Node's core modules for
// auto-instrumentation, which only works if it runs before those modules are first required) —
// so this file has no dependency on the NestJS/ConfigModule bootstrap and reads env vars directly.
import * as Sentry from '@sentry/nestjs';

// Route prefixes hit constantly on the disbursement critical path (queueing, batching,
// approving, disbursing) — worth a bigger slice of a free-tier quota than background or
// admin/reporting traffic. Matched against the request path as a plain substring.
const HOT_PATHS = ['/queue', '/batches', '/monnify'];

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    // Requests carry vendor bank details and payout amounts — don't ship that to a third party
    // by default.
    sendDefaultPii: false,
    tracesSampler: (samplingContext) => {
      if (samplingContext.parentSampled !== undefined) {
        return samplingContext.inheritOrSampleWith(Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05));
      }

      const path = samplingContext.normalizedRequest?.url ?? '';
      if (HOT_PATHS.some((p) => path.includes(p))) {
        return Number(process.env.SENTRY_HOT_PATH_SAMPLE_RATE ?? 0.5);
      }
      return Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05);
    },
    integrations: [Sentry.prismaIntegration()],
  });
}
