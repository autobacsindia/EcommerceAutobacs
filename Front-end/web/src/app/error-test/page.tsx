'use client';

import React, { useState, useEffect } from 'react';

export default function ErrorTestPage() {
  const [errorType, setErrorType] = useState<'none' | 'component' | 'network'>('none');
  const [error, setError] = useState<Error | null>(null);

  // Component error test
  if (errorType === 'component') {
    throw new Error('This is a test component error');
  }

  // Network error test
  useEffect(() => {
    if (errorType === 'network') {
      const fetchData = async () => {
        try {
          const response = await fetch('/api/non-existent-endpoint');
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
        } catch (err) {
          setError(err as Error);
        }
      };
      
      fetchData();
    }
  }, [errorType]);

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Error Handling Test</h1>
          
          <div className="space-y-4">
            <p className="text-gray-600">
              This page is for testing error handling functionality. Click the buttons below to trigger different types of errors.
            </p>
            
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setErrorType('component')}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                Trigger Component Error
              </button>
              
              <button
                onClick={() => setErrorType('network')}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Trigger Network Error
              </button>
              
              <button
                onClick={() => {
                  setErrorType('none');
                  setError(null);
                }}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                Reset
              </button>
            </div>
            
            {error && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
                <h3 className="text-red-800 font-medium">Network Error Caught:</h3>
                <p className="text-red-700 mt-1">{error.message}</p>
              </div>
            )}
            
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
              <h3 className="text-blue-800 font-medium">How Error Handling Works:</h3>
              <ul className="mt-2 list-disc list-inside text-blue-700 space-y-1">
                <li>Component errors are caught by the ErrorBoundary component</li>
                <li>Network errors are handled with retry logic in our API utilities</li>
                <li>All errors are logged to the console for debugging</li>
                <li>In production, errors would be sent to an error tracking service</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}