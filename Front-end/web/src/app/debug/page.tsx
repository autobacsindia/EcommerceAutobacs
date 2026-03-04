'use client';

import React, { useState, useEffect } from 'react';

export default function DebugPage() {
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const checkHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      // Try to fetch from the Next.js API rewrite
      const res = await fetch('/api/health');
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      setHealthStatus(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Deployment Debugger</h1>
      
      <div className="grid gap-6">
        <div className="p-4 border rounded shadow">
          <h2 className="text-xl font-semibold mb-2">Environment Variables (Client-Side)</h2>
          <ul className="space-y-2">
            <li>
              <strong>NEXT_PUBLIC_API_URL:</strong>{' '}
              <span className={apiUrl ? 'text-green-600' : 'text-red-600'}>
                {apiUrl || 'Not Set'}
              </span>
            </li>
            <li>
              <strong>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:</strong>{' '}
              <span className={mapsKey && mapsKey !== 'your_client_key_here' ? 'text-green-600' : 'text-red-600'}>
                {mapsKey ? (mapsKey === 'your_client_key_here' ? 'Default Placeholder (Invalid)' : 'Set (Hidden)') : 'Not Set'}
              </span>
            </li>
          </ul>
        </div>

        <div className="p-4 border rounded shadow">
          <h2 className="text-xl font-semibold mb-2">Backend Connectivity</h2>
          <p className="mb-4 text-gray-600">
            Tests connection to <code>/api/health</code> (should proxy to backend)
          </p>
          
          <button
            onClick={checkHealth}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Testing...' : 'Test Connection'}
          </button>

          {error && (
            <div className="mt-4 p-3 bg-red-100 text-red-700 rounded">
              <strong>Error:</strong> {error}
            </div>
          )}

          {healthStatus && (
            <div className="mt-4">
              <h3 className="font-semibold text-green-700">Success! Backend Response:</h3>
              <pre className="mt-2 p-3 bg-gray-100 rounded overflow-auto text-sm">
                {JSON.stringify(healthStatus, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
