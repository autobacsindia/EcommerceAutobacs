// Test component to verify search functionality
'use client';

import { useEffect, useState } from 'react';

export default function TestSearch() {
  const [testResults, setTestResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const testSearch = async () => {
    setLoading(true);
    try {
      // Test basic search
      const response = await fetch('/api/products/suggestions?q=test&limit=5');
      const data = await response.json();
      setTestResults(data);
    } catch (error) {
      console.error('Test failed:', error);
      setTestResults({ error: 'Test failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Search Functionality Test</h2>
      <button 
        onClick={testSearch}
        disabled={loading}
        className="bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
      >
        {loading ? 'Testing...' : 'Test Search Suggestions'}
      </button>
      
      {testResults && (
        <div className="mt-4 p-4 bg-gray-100 rounded">
          <h3 className="font-bold">Test Results:</h3>
          <pre className="mt-2 text-sm overflow-auto">
            {JSON.stringify(testResults, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}