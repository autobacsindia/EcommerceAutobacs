'use client';

import { useEffect } from 'react';

export default function ProductsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureException(error, {
        tags: { type: 'route-error', scope: 'products-listing' },
        extra: { digest: error.digest, url: window.location.href },
      });
    }
    console.error('[Products Error]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-obsidian-deep px-4">
      <div className="max-w-md w-full bg-obsidian shadow-lg rounded-lg p-8">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-4">
            <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          <h2 className="text-2xl font-bold text-ink mb-2">Products unavailable</h2>
          <p className="text-ink-muted mb-6">
            We couldn&apos;t load the product catalog. Please try again in a moment.
          </p>

          <div className="space-y-3">
            <button
              onClick={reset}
              className="w-full inline-flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-obsidian bg-gold hover:bg-gold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gold transition-colors"
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
