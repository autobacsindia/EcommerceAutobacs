'use client';

import { useState, useEffect } from 'react';

export default function TestApiPage() {
  const [testResult, setTestResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const testApiConnectivity = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api-test');
      const data = await response.json();
      setTestResult(data);
    } catch (error: any) {
      console.error('Test API Error:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      setTestResult({
        success: false,
        error: error.message || 'Failed to connect to test API endpoint'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    testApiConnectivity();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">API Connectivity Test</h1>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Test Results</h2>
          
          {loading ? (
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-3"></div>
              <span>Testing API connectivity...</span>
            </div>
          ) : testResult ? (
            <div className={`p-4 rounded ${testResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              <h3 className={`font-medium ${testResult.success ? 'text-green-800' : 'text-red-800'}`}>
                {testResult.success ? '✅ Success' : '❌ Error'}
              </h3>
              <pre className="mt-2 text-sm overflow-auto bg-gray-100 p-3 rounded">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-gray-500">No test results available</p>
          )}
        </div>
        
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Actions</h2>
          <button
            onClick={testApiConnectivity}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Testing...' : 'Retest API Connectivity'}
          </button>
          
          <div className="mt-6">
            <h3 className="font-medium mb-2">Troubleshooting Steps:</h3>
            <ul className="list-disc pl-5 space-y-2 text-gray-700">
              <li>Ensure the backend server is running on port 5000</li>
              <li>Check if you can access <code className="bg-gray-100 px-1 rounded">http://localhost:5000/products</code> directly</li>
              <li>Verify the <code className="bg-gray-100 px-1 rounded">NEXT_PUBLIC_API_BASE_URL</code> environment variable is set correctly</li>
              <li>Check browser console for any CORS or network errors</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}