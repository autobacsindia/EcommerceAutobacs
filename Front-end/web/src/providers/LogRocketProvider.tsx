'use client';

import { useEffect } from 'react';

/**
 * LogRocket Provider - Frontend Session Replay & Error Tracking
 *
 * Complements Sentry by providing session replay, interaction tracking, network
 * request logging and console capture.
 *
 * PERFORMANCE: LogRocket is heavy (it instruments the DOM, fetch/XHR and the
 * console). We therefore (1) LAZY-import the library so its runtime is NOT in the
 * initial JS bundle and never parses on the critical path, and (2) defer
 * `init()` until the browser is idle, so recording setup never competes with
 * hydration + first paint. This is a large Total-Blocking-Time win on throttled
 * mobile CPUs, at the cost of the first ~fraction of a second of a session not
 * being recorded (an acceptable trade for session replay).
 *
 * Setup:
 * 1. Create account: https://app.logrocket.com/
 * 2. Get App ID from settings
 * 3. Add NEXT_PUBLIC_LOGROCKET_APP_ID to .env
 */

// Cached lazy import — the module is fetched at most once and shared by init()
// and the identify/track helpers below. logrocket ships as a CJS `export =`, so
// under esModuleInterop the dynamic import resolves to { default: LogRocket };
// unwrap to the real instance (which is what the namespace type describes).
type LogRocketModule = typeof import('logrocket');
let logRocketPromise: Promise<LogRocketModule> | null = null;
const loadLogRocket = () => {
  if (!logRocketPromise) {
    logRocketPromise = import('logrocket').then(
      (m) => ((m as { default?: LogRocketModule }).default ?? m) as LogRocketModule,
    );
  }
  return logRocketPromise;
};

type IdleWindow = typeof window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function LogRocketProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_LOGROCKET_APP_ID;
    if (!appId) {
      console.warn('[LogRocket] App ID not configured - session replay disabled');
      return;
    }

    let cancelled = false;
    const start = () => {
      loadLogRocket()
        .then((LogRocket) => {
          if (cancelled) return;
          LogRocket.init(appId, {
            network: {
              requestSanitizer: (request) => {
                // Remove sensitive headers
                if (request.headers?.authorization) {
                  request.headers.authorization = '***REDACTED***';
                }
                return request;
              },
            },
            dom: {
              // Don't record input values (privacy)
              inputSanitizer: true,
            },
          });
          console.log('[LogRocket] Initialized (deferred)');
        })
        .catch(() => {
          /* network/parse failure — session replay simply stays off */
        });
    };

    const w = window as IdleWindow;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (typeof w.requestIdleCallback === 'function') {
      idleId = w.requestIdleCallback(start, { timeout: 5000 });
    } else {
      timeoutId = setTimeout(start, 3000);
    }

    return () => {
      cancelled = true;
      if (idleId !== undefined && typeof w.cancelIdleCallback === 'function') {
        w.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, []);

  return <>{children}</>;
}

/**
 * Helper to identify logged-in users in LogRocket. Call after successful login.
 * Fire-and-forget: lazy-loads LogRocket if not yet loaded.
 */
export const identifyLogRocketUser = (user: {
  id: string;
  email?: string;
  name?: string;
}) => {
  if (!process.env.NEXT_PUBLIC_LOGROCKET_APP_ID) return;
  loadLogRocket()
    .then((LogRocket) => {
      const traits: Record<string, string | number | boolean> = {
        email: user.email || '',
        name: user.name || '',
      };
      LogRocket.identify(user.id, traits);
    })
    .catch(() => {});
};

/**
 * Helper to log custom events. Fire-and-forget.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const logLogRocketEvent = (event: string, data?: Record<string, any>) => {
  if (!process.env.NEXT_PUBLIC_LOGROCKET_APP_ID) return;
  loadLogRocket()
    .then((LogRocket) => {
      LogRocket.track(event, data);
    })
    .catch(() => {});
};
