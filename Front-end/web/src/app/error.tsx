'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error('Route error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white shadow rounded-lg p-6">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
            <svg className="h-6 w-6 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="mt-2 text-lg font-medium text-gray-900">Something went wrong</h3>
          <p className="mt-1 text-sm text-gray-500">
            Please try again. If the problem persists, contact support.
          </p>
          <div className="mt-6 flex gap-3 justify-center">
            <button
              type="button"
              className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              onClick={() => reset()}
            >
              Try Again
            </button>
            <button
              type="button"
              className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-blue-600 bg-blue-50 hover:bg-blue-100"
              onClick={() => router.push('/contact')}
            >
              Contact Support
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
