'use client';

import { useEffect } from 'react';

export default function OrdersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureException(error, {
        tags: { type: 'route-error', scope: 'orders' },
        extra: { digest: error.digest, url: window.location.href },
      });
    }
    console.error('[Orders Error]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-obsidian-deep px-4">
      <div className="max-w-md w-full bg-obsidian shadow-lg rounded-lg p-8">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-4">
            <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>

          <h2 className="text-2xl font-bold text-ink mb-2">Orders unavailable</h2>
          <p className="text-ink-muted mb-6">
            We couldn&apos;t load your orders right now. Your order history is safe — please try again.
          </p>

          <div className="space-y-3">
            <button
              onClick={reset}
              className="w-full inline-flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-obsidian bg-gold hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gold transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => { window.location.href = '/'; }}
              className="w-full inline-flex justify-center items-center px-6 py-3 border border-hairline text-base font-medium rounded-md text-ink/80 bg-obsidian hover:bg-obsidian-deep focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gold transition-colors"
            >
              Go Home
            </button>
          </div>

          {process.env.NODE_ENV === 'development' && (
            <details className="mt-6 text-left">
              <summary className="cursor-pointer text-sm text-ink-muted hover:text-ink/80">
                Error Details (Dev Only)
              </summary>
              <div className="mt-2 p-4 bg-obsidian-raised rounded text-xs overflow-auto max-h-64">
                <p className="font-mono text-red-600 mb-2">{error.message}</p>
                <pre className="text-ink/80 whitespace-pre-wrap">{error.stack}</pre>
                {error.digest && <p className="mt-2 text-ink-muted">Digest: {error.digest}</p>}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
