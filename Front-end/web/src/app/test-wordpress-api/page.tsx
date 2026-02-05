'use client';

import { useState, useEffect } from 'react';
import { wordpressService } from '@/services/wordpressService';
import wordpressDebug from '@/lib/wordpressDebug';

export default function TestWordPressAPIPage() {
  const [testResults, setTestResults] = useState({
    config: null as any,
    vehicles: null as any,
    products: null as any,
    categories: null as any,
    loading: true,
    error: null as string | null
  });

  useEffect(() => {
    const runTests = async () => {
      try {
        // Check configuration
        const config = wordpressDebug.logConfig();
        
        // Test API calls
        const vehicles = await wordpressService.getAllVehicles();
        const products = await wordpressService.getProductsByVehicle('test-vehicle');
        const categories = await wordpressService.getProductCategories();
        
        setTestResults({
          config,
          vehicles: {
            count: vehicles.length,
            sample: vehicles.slice(0, 3)
          },
          products: {
            count: (products as any).products?.length || (products as any).length || 0,
            sample: ((products as any).products || (products as any) || []).slice(0, 3)
          },
          categories: {
            count: categories.length,
            sample: categories.slice(0, 3)
          },
          loading: false,
          error: null
        });
      } catch (error: any) {
        console.error('WordPress API Test Error:', error);
        setTestResults(prev => ({
          ...prev,
          loading: false,
          error: error.message || 'Failed to test WordPress API'
        }));
      }
    };

    runTests();
  }, []);

  if (testResults.loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Testing WordPress API...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">WordPress API Test Results</h1>
        
        {testResults.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-8">
            <h2 className="text-xl font-semibold text-red-800 mb-4">Error</h2>
            <p className="text-red-700">{testResults.error}</p>
          </div>
        )}
        
        {/* Configuration */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Configuration</h2>
          <div className="space-y-2">
            <p><strong>Site URL:</strong> {testResults.config?.siteUrl || 'Not set'}</p>
            <p><strong>API Version:</strong> {testResults.config?.apiVersion || 'Not set'}</p>
            <p><strong>Fully Configured:</strong> {testResults.config?.isConfigured ? 'Yes' : 'No'}</p>
            {testResults.config?.missing && testResults.config.missing.length > 0 && (
              <p><strong>Missing:</strong> {testResults.config.missing.join(', ')}</p>
            )}
          </div>
        </div>
        
        {/* Vehicles */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Vehicles</h2>
          <p>Total vehicles: {testResults.vehicles?.count || 0}</p>
          {testResults.vehicles?.sample && (
            <div className="mt-4">
              <h3 className="font-medium text-gray-900 mb-2">Sample:</h3>
              <pre className="bg-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                {JSON.stringify(testResults.vehicles.sample, null, 2)}
              </pre>
            </div>
          )}
        </div>
        
        {/* Products */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Products</h2>
          <p>Total products: {testResults.products?.count || 0}</p>
          {testResults.products?.sample && (
            <div className="mt-4">
              <h3 className="font-medium text-gray-900 mb-2">Sample:</h3>
              <pre className="bg-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                {JSON.stringify(testResults.products.sample, null, 2)}
              </pre>
            </div>
          )}
        </div>
        
        {/* Categories */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Categories</h2>
          <p>Total categories: {testResults.categories?.count || 0}</p>
          {testResults.categories?.sample && (
            <div className="mt-4">
              <h3 className="font-medium text-gray-900 mb-2">Sample:</h3>
              <pre className="bg-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                {JSON.stringify(testResults.categories.sample, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}