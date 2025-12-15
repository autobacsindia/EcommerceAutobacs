'use client';

import React, { useState } from 'react';
import apiClient, { ApiError } from '@/lib/api';
import { useRateLimit } from '@/contexts/RateLimitContext';

const RateLimitDemoPage = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { showRateLimitNotification } = useRateLimit();

  const makeApiCall = async () => {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      // Make a request to a route that might be rate limited
      const data = await apiClient.get('/products');
      setResult(`Success! Retrieved ${data.products?.length || 0} products`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429 && err.rateLimitInfo?.retryAfter) {
        // Show rate limit notification
        showRateLimitNotification(err.rateLimitInfo.retryAfter);
        setError('Rate limit exceeded. Please wait before trying again.');
      } else {
        setError(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const triggerRateLimit = async () => {
    // Make rapid requests to trigger rate limiting
    for (let i = 0; i < 10; i++) {
      try {
        await apiClient.get('/products');
      } catch (err) {
        if (err instanceof ApiError && err.status === 429 && err.rateLimitInfo?.retryAfter) {
          showRateLimitNotification(err.rateLimitInfo.retryAfter);
          setError('Rate limit triggered! Notification should appear.');
          break;
        }
      }
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Rate Limiting Demo</h1>
      
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Test Rate Limiting</h2>
        <p className="mb-4">
          This demo shows how the application handles rate limiting errors from the API.
        </p>
        
        <div className="flex gap-4 mb-4">
          <button
            onClick={makeApiCall}
            disabled={loading}
            className="bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Make API Call'}
          </button>
          
          <button
            onClick={triggerRateLimit}
            className="bg-red-500 hover:bg-red-600 text-white font-medium py-2 px-4 rounded"
          >
            Trigger Rate Limit
          </button>
        </div>
        
        {result && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
            {result}
          </div>
        )}
        
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
      </div>
      
      <div className="bg-gray-50 rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">How It Works</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>When an API request receives a 429 (Too Many Requests) response, the client automatically shows a notification</li>
          <li>The notification includes a countdown timer showing when the user can try again</li>
          <li>Behind the scenes, the API client implements exponential backoff with jitter for automatic retries</li>
          <li>If all retries are exhausted, the error is surfaced to the user</li>
        </ul>
      </div>
    </div>
  );
};

export default RateLimitDemoPage;