'use client';

import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { reportClientError, setReporterViewer } from '@/lib/reportClientError';

/**
 * Reports uncaught script errors and unhandled promise rejections to the "Website
 * errors" page (lib/reportClientError.ts), and tells the reporter who is signed in
 * so staff and admins are never reported. Renders nothing.
 *
 * Deliberately NOT lib/globalErrorHandlers.ts: that file patches
 * EventTarget.prototype.addEventListener for every listener on the page. Plain
 * window listeners see the same errors without touching anything else.
 */
/**
 * Path of the failing script (no origin or query string), line and column — or 'inline'.
 *
 * The key is `script`, NOT `file`: the backend drops every context key containing
 * "file" (utils/clientErrorScrub.js — upload file names can carry a person's name),
 * so a `file` key never reached the Website errors page and "Invalid or unexpected
 * token" stayed undiagnosable.
 */
export function scriptLocation(event: Pick<ErrorEvent, 'filename' | 'lineno' | 'colno'>): Record<string, string | number> {
  let script = 'inline';
  try {
    if (event.filename) {
      const u = new URL(event.filename, window.location.href);
      script = u.origin === window.location.origin ? u.pathname : `${u.origin}${u.pathname}`;
    }
  } catch {
    script = 'unknown';
  }
  return { script, line: event.lineno || 0, col: event.colno || 0 };
}

export default function ClientErrorReporter() {
  const { user } = useAuth();

  useEffect(() => {
    setReporterViewer(user?.role);
  }, [user?.role]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportClientError({
        feature: 'script',
        step: 'uncaught',
        error: event.error ?? undefined,
        message: event.error ? undefined : event.message,
        // Which script broke. A SyntaxError ("Invalid or unexpected token") has no
        // useful stack, so without this we cannot tell our own chunk (bad/cut-off
        // download) from a script an in-app browser or extension injected.
        context: scriptLocation(event),
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      reportClientError({ feature: 'script', step: 'unhandled-rejection', error: event.reason });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
