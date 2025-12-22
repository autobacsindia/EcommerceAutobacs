'use client';

import { useState } from 'react';
import { wordpressService } from '@/services/wordpressService';

export default function TestConnectivity() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testConnectivity = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    
    try {
      // Test vehicles endpoint
      const vehicles = await wordpressService.getAllVehicles();
      setResult({
        success: true,
        vehicles: vehicles.length,
        message: `Successfully connected to WordPress API. Found ${vehicles.length} vehicles.`
      });
    } catch (err: any) {
      setError(err.message || 'Failed to connect to WordPress API');
      setResult({
        success: false,
        message: err.message || 'Failed to connect to WordPress API'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">WordPress API Connectivity Test</h1>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Test Connection</h2>
          <p className="text-gray-600 mb-4">
            Click the button below to test connectivity to your WordPress API.
          </p>
          
          <button
            onClick={testConnectivity}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-blue-400"
          >
            {loading ? 'Testing...' : 'Test WordPress API Connection'}
          </button>
        </div>
        
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-medium text-red-800 mb-2">Error</h3>
            <p className="text-red-600">{error}</p>
          </div>
        )}
        
        {result && (
          <div className={`rounded-lg p-6 mb-6 ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <h3 className={`text-lg font-medium mb-2 ${result.success ? 'text-green-800' : 'text-red-800'}`}>
              {result.success ? 'Success' : 'Failed'}
            </h3>
            <p className={result.success ? 'text-green-600' : 'text-red-600'}>
              {result.message}
            </p>
          </div>
        )}
        
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-800 mb-4">Troubleshooting Tips</h3>
          <ul className="list-disc pl-5 space-y-2 text-gray-600">
            <li>Verify your WordPress site URL is correct and accessible</li>
            <li>Ensure your WordPress REST API is enabled</li>
            <li>Check that your consumer key and secret are correct</li>
            <li>Confirm your WordPress site has the vehicle taxonomy configured</li>
            <li>Make sure CORS is properly configured on your WordPress site</li>
            <li>Check browser console for detailed error information</li>
          </ul>
        </div>
      </div>
    </div>
  );
}'use client';

import { useState } from 'react';
import { wordpressService } from '@/services/wordpressService';

export default function TestConnectivity() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testConnectivity = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    
    try {
      // Test vehicles endpoint
      const vehicles = await wordpressService.getAllVehicles();
      setResult({
        success: true,
        vehicles: vehicles.length,
        message: `Successfully connected to WordPress API. Found ${vehicles.length} vehicles.`
      });
    } catch (err: any) {
      setError(err.message || 'Failed to connect to WordPress API');
      setResult({
        success: false,
        message: err.message || 'Failed to connect to WordPress API'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">WordPress API Connectivity Test</h1>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Test Connection</h2>
          <p className="text-gray-600 mb-4">
            Click the button below to test connectivity to your WordPress API.
          </p>
          
          <button
            onClick={testConnectivity}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-blue-400"
          >
            {loading ? 'Testing...' : 'Test WordPress API Connection'}
          </button>
        </div>
        
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-medium text-red-800 mb-2">Error</h3>
            <p className="text-red-600">{error}</p>
          </div>
        )}
        
        {result && (
          <div className={`rounded-lg p-6 mb-6 ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <h3 className={`text-lg font-medium mb-2 ${result.success ? 'text-green-800' : 'text-red-800'}`}>
              {result.success ? 'Success' : 'Failed'}
            </h3>
            <p className={result.success ? 'text-green-600' : 'text-red-600'}>
              {result.message}
            </p>
          </div>
        )}
        
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-800 mb-4">Troubleshooting Tips</h3>
          <ul className="list-disc pl-5 space-y-2 text-gray-600">
            <li>Verify your WordPress site URL is correct and accessible</li>
            <li>Ensure your WordPress REST API is enabled</li>
            <li>Check that your consumer key and secret are correct</li>
            <li>Confirm your WordPress site has the vehicle taxonomy configured</li>
            <li>Make sure CORS is properly configured on your WordPress site</li>
            <li>Check browser console for detailed error information</li>
          </ul>
        </div>
      </div>
    </div>
  );
}