/**
 * Customer-facing website errors (models/ClientError.js) — the shared vocabulary
 * and the limits that keep the collection small.
 *
 * The storefront reports what went wrong for a CUSTOMER (a page crash, a careers
 * upload that failed, a payment that failed); staff and admin pages are never
 * reported. Repeats of one error collapse into ONE record with a counter, so the
 * collection grows with the number of DIFFERENT errors, never with traffic — the
 * opposite of `rate_limit_events`, which once filled 95% of the database with one
 * insert per request.
 */

/** What part of the site failed. The Marketing panel sees PAYMENT and CAREERS only. */
export const CLIENT_ERROR_FEATURES = Object.freeze({
  PAGE_CRASH: 'page-crash',     // an error page replaced the screen (app/error.tsx, global-error.tsx)
  SCRIPT: 'script',             // an uncaught error or unhandled promise rejection
  CHECKOUT: 'checkout',         // placing the order failed (before any payment)
  PAYMENT: 'payment',           // Razorpay: gateway load, open, failed, cancelled, verify
  CAREERS: 'careers',           // job application: upload signature, file upload, submit
});
export const CLIENT_ERROR_FEATURE_VALUES = Object.freeze(Object.values(CLIENT_ERROR_FEATURES));

export const CLIENT_ERROR_FEATURE_LABELS = Object.freeze({
  'page-crash': 'Page crash',
  script: 'Script error',
  checkout: 'Checkout',
  payment: 'Payment',
  careers: 'Careers',
});

/** Features the marketing team may read (the money and hiring funnels they run). */
export const MARKETING_CLIENT_ERROR_FEATURES = Object.freeze([
  CLIENT_ERROR_FEATURES.PAYMENT,
  CLIENT_ERROR_FEATURES.CHECKOUT,
  CLIENT_ERROR_FEATURES.CAREERS,
]);

/** `warning` = the customer chose it or could recover (closed the payment window). */
export const CLIENT_ERROR_LEVELS = Object.freeze(['error', 'warning']);

export const CLIENT_ERROR_STATUSES = Object.freeze({ OPEN: 'open', RESOLVED: 'resolved' });
export const CLIENT_ERROR_STATUS_VALUES = Object.freeze(Object.values(CLIENT_ERROR_STATUSES));

export const CLIENT_ERROR_LIMITS = Object.freeze({
  /** A report bigger than this (serialised) is refused outright. */
  maxPayloadBytes: 16 * 1024,
  message: 500,
  stack: 4000,
  step: 60,
  url: 300,
  name: 80,
  /** Extra key/value context the storefront attaches (HTTP status, error code…). */
  contextKeys: 12,
  contextValue: 200,
  /** Recent examples kept on each record; older ones fall off ($slice). */
  samples: 3,
  /** Records disappear this long after the error LAST happened (TTL on expireAt). */
  retentionDays: 30,
  /** Ceiling on DIFFERENT errors stored. Past it, only known errors are counted. */
  maxRecords: 2000,
  /** Per app instance: database writes per error per minute. Extra hits are batched into the next write. */
  writesPerSignaturePerMinute: 6,
  /** Per app instance: database writes for all errors per minute. */
  writesPerMinute: 300,
});
