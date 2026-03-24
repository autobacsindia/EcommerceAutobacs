import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

/**
 * A real Sentry DSN looks like:
 *   https://<key>@<org>.ingest.sentry.io/<project-id>
 * This rejects the placeholder "your_sentry_dsn_url" and other obviously
 * invalid values so startup logs clearly surface misconfiguration.
 */
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
      // Non-fatal but important: errors won't reach Sentry without a real DSN.
      // Set SENTRY_DSN in your Railway dashboard to fix this.
      console.warn('[Sentry] WARNING: SENTRY_DSN is missing or invalid in production. Error tracking is disabled.');
    } else {
      console.log('[Sentry] DSN not configured — skipping init (expected in development).');
    }
    return;
  }

  Sentry.init({
    dsn,
    integrations: [
      nodeProfilingIntegration(),
    ],
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    profilesSampleRate: 1.0,
    environment: process.env.NODE_ENV || 'development',
  });

  console.log(`[Sentry] ✓ Initialized (env: ${process.env.NODE_ENV}, tracesSampleRate: ${process.env.NODE_ENV === 'production' ? 0.1 : 1.0})`);
};

export default Sentry;
