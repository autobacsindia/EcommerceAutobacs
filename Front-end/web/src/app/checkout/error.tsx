'use client';

import { useEffect } from 'react';

export default function CheckoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureException(error, {
        tags: { type: 'route-error', scope: 'checkout' },
        extra: { digest: error.digest, url: window.location.href },
      });
    }
    console.error('[Checkout Error]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-4">
            <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-2">Checkout unavailable</h2>
          <p className="text-gray-600 mb-6">
            We couldn&apos;t complete your checkout. Your cart items are safe — please try again or return to your cart.
          </p>

          <div className="space-y-3">
            <button
              onClick={reset}
              className="w-full inline-flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => { window.location.href = '/cart'; }}
              className="w-full inline-flex justify-center items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            >
              Return to Cart
            </button>
          </div>

          {process.env.NODE_ENV === 'development' && (
            <details className="mt-6 text-left">
              <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                Error Details (Dev Only)
              </summary>
              <div className="mt-2 p-4 bg-gray-100 rounded text-xs overflow-auto max-h-64">
                <p className="font-mono text-red-600 mb-2">{error.message}</p>
                <pre className="text-gray-700 whitespace-pre-wrap">{error.stack}</pre>
                {error.digest && <p className="mt-2 text-gray-500">Digest: {error.digest}</p>}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
