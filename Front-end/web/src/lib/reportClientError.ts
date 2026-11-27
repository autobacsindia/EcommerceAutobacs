/**
 * Tell our server that something went wrong for a CUSTOMER — a page crash, a
 * careers upload that failed, a payment that failed. The DevOps, Admin and
 * Marketing panels read these ("Website errors"); the backend groups repeats of
 * one error into a single record (Back-end/server/routes/clientErrors.js).
 *
 * Rules this file keeps:
 *   - It NEVER throws and never blocks: fire-and-forget, every step in try/catch.
 *     A failure to report must not become a second error for the customer.
 *   - Customers only: staff pages (/admin, /team …) and staff sessions are skipped.
 *     The server checks the session again; this only saves the request.
 *   - No personal data is sent: the URL goes without its query string, and callers
 *     pass codes and statuses as context, never names, emails, phones or file names.
 *     The server scrubs everything again regardless.
 *   - A broken page cannot flood: the same error is sent once per 30 seconds, and
 *     at most 15 reports per page load.
 */

export type ClientErrorFeature = 'page-crash' | 'script' | 'checkout' | 'payment' | 'careers';

export interface ClientErrorReport {
  feature: ClientErrorFeature;
  /** Where in the feature: 'upload-signature', 'file-upload', 'payment-failed'… */
  step?: string;
  /** The thrown value, if any. Its name, message and stack are sent. */
  error?: unknown;
  /** A message to use instead of (or when there is no) error. */
  message?: string;
  /** 'warning' for things the customer chose or recovered from (closing the payment window). */
  level?: 'error' | 'warning';
  /** Our order id (Mongo id) when the error is about an order. */
  orderId?: string | null;
  /** Small, non-personal facts: HTTP status, gateway error code, upload slot. */
  context?: Record<string, string | number | boolean | null | undefined>;
}

// Same-origin: next.config.ts rewrites /api/v1/* to the backend.
const ENDPOINT = '/api/v1/client-errors';
const STAFF_PREFIXES = ['/admin', '/team', '/staff-invite', '/dev', '/partner'];
const REPEAT_WINDOW_MS = 30_000;
const MAX_PER_PAGE_LOAD = 15;

// Noise every site sees that we can do nothing about.
const IGNORED_MESSAGES = [
  /^Script error\.?$/i, // a cross-origin script; the browser hides the details
  /ResizeObserver loop/i,
  /^AbortError/i,
  /The user aborted a request/i,
  /Non-Error promise rejection captured/i,
];

let viewerIsStaff = false;
let sentThisLoad = 0;
const lastSent = new Map<string, number>();

/** Set by <ClientErrorReporter> from the signed-in user: staff and admins are never reported. */
export function setReporterViewer(role: string | null | undefined): void {
  viewerIsStaff = role === 'staff' || role === 'admin';
}

/** Test seam. */
export function resetClientErrorReporter(): void {
  viewerIsStaff = false;
  sentThisLoad = 0;
  lastSent.clear();
}

export const isStaffPath = (path: string): boolean =>
  STAFF_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

function describe(error: unknown, fallback?: string): { name: string; message: string; stack: string } {
  if (error instanceof Error) {
    return { name: error.name || 'Error', message: fallback || error.message || 'Unknown error', stack: error.stack || '' };
  }
  if (error && typeof error === 'object') {
    const e = error as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      name: typeof e.name === 'string' ? e.name : 'Error',
      message: fallback || (typeof e.message === 'string' ? e.message : 'Unknown error'),
      stack: typeof e.stack === 'string' ? e.stack : '',
    };
  }
  return { name: 'Error', message: fallback || (error == null ? 'Unknown error' : String(error)), stack: '' };
}

/** The storefront build that is running, so a fix can be matched to a deploy. */
const RELEASE = (process.env.NEXT_PUBLIC_RELEASE || '').slice(0, 12);

export function reportClientError(input: ClientErrorReport): void {
  try {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    if (viewerIsStaff) return;
    const path = window.location.pathname || '/';
    if (isStaffPath(path)) return;

    const { name, message, stack } = describe(input.error, input.message);
    if (IGNORED_MESSAGES.some((re) => re.test(message)) || name === 'AbortError') return;
    // Errors thrown by browser extensions are not ours to fix.
    if (/chrome-extension:|moz-extension:|safari-extension:/.test(stack)) return;

    const key = `${input.feature}|${input.step || ''}|${name}|${message}`.slice(0, 300);
    const now = Date.now();
    const prev = lastSent.get(key);
    if (prev && now - prev < REPEAT_WINDOW_MS) return;
    if (sentThisLoad >= MAX_PER_PAGE_LOAD) return;
    lastSent.set(key, now);
    sentThisLoad += 1;

    const context: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(input.context || {})) {
      if (v !== null && v !== undefined && v !== '') context[k] = v;
    }

    const body = JSON.stringify({
      feature: input.feature,
      step: input.step || '',
      level: input.level || 'error',
      name: name.slice(0, 80),
      message: message.slice(0, 500),
      stack: stack.slice(0, 4000),
      // Origin + path only: query strings carry payment and reset tokens.
      url: `${window.location.origin}${path}`,
      release: RELEASE,
      orderId: input.orderId || undefined,
      context: Object.keys(context).length ? context : undefined,
    });

    // keepalive: the report survives a reload or navigation that follows it
    // (global-error reloads the page right after a failed script download).
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body,
    }).catch(() => { /* best-effort */ });
  } catch {
    /* never let reporting break the page */
  }
}

/** The HTTP status on an error from lib/api (ApiError / fetch wrappers), if any. */
export function httpStatusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  const s = e.status ?? e.statusCode ?? e.response?.status;
  return typeof s === 'number' ? s : undefined;
}
