import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

// P1 conditions: payment failures, auth system errors, and all 5xx server errors.
// These get tagged alert_level=p1 in Sentry so alert rules can target them precisely.
const P1_ERROR_PATTERNS = [
  /payment.*fail/i,
  /razorpay/i,
  /database.*connect/i,
  /mongo.*connect/i,
  /ECONNREFUSED/,
  /auth.*fail/i,
];

function isP1Error(event) {
  if (event.tags?.statusCode >= 500) return true;
  const msg = event.exception?.values?.[0]?.value || '';
  return P1_ERROR_PATTERNS.some(re => re.test(msg));
}

function isValidDsn(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.includes('sentry.io');
  } catch {
    return false;
  }
}

/**
 * Initialize Sentry for error tracking and performance monitoring.
 * In production, a missing or placeholder DSN is a WARN-level issue —
 * errors will still be handled correctly but won't reach your observability layer.
 */
export const initSentry = () => {
  const dsn = process.env.SENTRY_DSN;

  if (!isValidDsn(dsn)) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[Sentry] WARNING: SENTRY_DSN is missing or invalid in production. Error tracking is disabled.');
    } else {
      console.log('[Sentry] DSN not configured — skipping init (expected in development).');
    }
    return;
  }

  const release = process.env.SENTRY_RELEASE || process.env.npm_package_version;

  Sentry.init({
    dsn,
    release,
    integrations: [
      nodeProfilingIntegration(),
    ],
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    environment: process.env.NODE_ENV || 'development',
    beforeSend(event) {
      // Tag P1 errors so Sentry alert rules can filter on alert_level=p1
      if (isP1Error(event)) {
        event.tags = { ...event.tags, alert_level: 'p1' };
      }
      return event;
    },
  });

  console.log(`[Sentry] ✓ Initialized (env: ${process.env.NODE_ENV}, release: ${release || 'unset'}, tracesSampleRate: ${process.env.NODE_ENV === 'production' ? 0.1 : 1.0})`);
};

export default Sentry;
