/**
 * Next.js App Router Global Error Page
 * 
 * Catches:
 * - Server-side rendering errors
 * - Server component crashes
 * - Layout errors
 * 
 * This is the LAST line of defense
 * 
 * Note: Must be in app/error.tsx (Next.js convention)
 */

'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to Sentry
    if (typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureException(error, {
        tags: {
          type: 'global-error',
          scope: 'server-component'
        },
        extra: {
          digest: error.digest,
          timestamp: new Date().toISOString(),
          url: window.location.href
        }
      });
    }

    console.error('[Global Error] Uncaught server error:', error);
  }, [error]);

  return (
    <html>
      <body>
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-4">
                <svg 
                  className="h-8 w-8 text-red-600" 
                  xmlns="http://www.w3.org/2000/svg" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
                  />
                </svg>
              </div>
              
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Something went wrong!
              </h2>
              
              <p className="text-gray-600 mb-6">
                We encountered an unexpected error. Please try again.
              </p>
              
              <div className="space-y-3">
                <button
                  onClick={reset}
                  className="w-full inline-flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                >
                  Try Again
                </button>
                
                <button
                  onClick={() => window.location.reload()}
                  className="w-full inline-flex justify-center items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                >
                  Refresh Page
                </button>
                
                <button
                  onClick={() => window.location.href = '/'}
                  className="w-full inline-flex justify-center items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                >
                  Go Home
                </button>
              </div>
              
              {process.env.NODE_ENV === 'development' && (
                <details className="mt-6 text-left">
                  <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                    Error Details (Dev Only)
                  </summary>
                  <div className="mt-2 p-4 bg-gray-100 rounded text-xs overflow-auto max-h-64">
                    <p className="font-mono text-red-600 mb-2">{error.message}</p>
                    <pre className="text-gray-700 whitespace-pre-wrap">
                      {error.stack}
                    </pre>
                    {error.digest && (
                      <p className="mt-2 text-gray-500">Digest: {error.digest}</p>
                    )}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
