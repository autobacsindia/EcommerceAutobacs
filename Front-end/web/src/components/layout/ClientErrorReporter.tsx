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
