import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
  tracesSampleRate: 0.2,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1,
  enabled: !!(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN)
});
