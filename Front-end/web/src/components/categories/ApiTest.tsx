'use client';

import { useState } from 'react';
import apiClient from '@/lib/api';

export default function ApiTest() {
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testCategoryApi = async (categoryId: string, categoryName: string) => {
    try {
      setLoading(true);
      setError(null);
      
      // Test 1: Get category by ID
      const categoryResponse: any = await apiClient.get(`/categories/${categoryId}`);
      
      // Test 2: Get products for this category
      const productsResponse: any = await apiClient.get(`/products?category=${categoryId}`);
      
      setResults({
        categoryName,
        categoryId,
        category: categoryResponse.category,
        productCount: productsResponse.products?.length || 0,
        products: productsResponse.products || []
      });
    } catch (err: any) {
      setError(err.message || 'Failed to test API');
      console.error('API Test Error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Category API Test</h1>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-4">Test Categories</h2>
        <div className="flex gap-4 flex-wrap">
          <button 
            onClick={() => testCategoryApi('673d3f821234567890abcdef', 'Body Kits')}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            disabled={loading}
          >
            Test Body Kits
          </button>
          
          <button 
            onClick={() => testCategoryApi('673d3f821234567890abc123', 'Audio')}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            disabled={loading}
          >
            Test Audio
          </button>
          
          <button 
            onClick={() => testCategoryApi('673d3f821234567890abc456', 'Lights')}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            disabled={loading}
          >
            Test Lights
          </button>
        </div>
      </div>
      
      {loading && (
        <div className="p-4 bg-yellow-100 rounded">
          Testing API... Please wait
        </div>
      )}
      
      {error && (
        <div className="p-4 bg-red-100 text-red-700 rounded">
          Error: {error}
        </div>
      )}
      
      {results && (
        <div className="p-4 bg-green-100 rounded">
          <h3 className="text-lg font-semibold mb-2">Test Results for {results.categoryName}</h3>
          <p><strong>Category ID:</strong> {results.categoryId}</p>
          <p><strong>Category Name:</strong> {results.category?.name}</p>
          <p><strong>Product Count:</strong> {results.productCount}</p>
          
          {results.productCount > 0 && (
            <div className="mt-4">
              <h4 className="font-medium mb-2">Sample Products:</h4>
              <ul className="list-disc pl-5">
                {results.products.slice(0, 5).map((product: any) => (
                  <li key={product._id}>{product.name}</li>
                ))}
              </ul>
              {results.productCount > 5 && (
                <p className="text-sm text-gray-600">... and {results.productCount - 5} more products</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}'use client';

import { useState } from 'react';
import apiClient from '@/lib/api';

export default function ApiTest() {
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testCategoryApi = async (categoryId: string, categoryName: string) => {
    try {
      setLoading(true);
      setError(null);
      
      // Test 1: Get category by ID
      const categoryResponse: any = await apiClient.get(`/categories/${categoryId}`);
      
      // Test 2: Get products for this category
      const productsResponse: any = await apiClient.get(`/products?category=${categoryId}`);
      
      setResults({
        categoryName,
        categoryId,
        category: categoryResponse.category,
        productCount: productsResponse.products?.length || 0,
        products: productsResponse.products || []
      });
    } catch (err: any) {
      setError(err.message || 'Failed to test API');
      console.error('API Test Error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Category API Test</h1>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-4">Test Categories</h2>
        <div className="flex gap-4 flex-wrap">
          <button 
            onClick={() => testCategoryApi('673d3f821234567890abcdef', 'Body Kits')}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            disabled={loading}
          >
            Test Body Kits
          </button>
          
          <button 
            onClick={() => testCategoryApi('673d3f821234567890abc123', 'Audio')}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            disabled={loading}
          >
            Test Audio
          </button>
          
          <button 
            onClick={() => testCategoryApi('673d3f821234567890abc456', 'Lights')}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            disabled={loading}
          >
            Test Lights
          </button>
        </div>
      </div>
      
      {loading && (
        <div className="p-4 bg-yellow-100 rounded">
          Testing API... Please wait
        </div>
      )}
      
      {error && (
        <div className="p-4 bg-red-100 text-red-700 rounded">
          Error: {error}
        </div>
      )}
      
      {results && (
        <div className="p-4 bg-green-100 rounded">
          <h3 className="text-lg font-semibold mb-2">Test Results for {results.categoryName}</h3>
          <p><strong>Category ID:</strong> {results.categoryId}</p>
          <p><strong>Category Name:</strong> {results.category?.name}</p>
          <p><strong>Product Count:</strong> {results.productCount}</p>
          
          {results.productCount > 0 && (
            <div className="mt-4">
              <h4 className="font-medium mb-2">Sample Products:</h4>
              <ul className="list-disc pl-5">
                {results.products.slice(0, 5).map((product: any) => (
                  <li key={product._id}>{product.name}</li>
                ))}
              </ul>
              {results.productCount > 5 && (
                <p className="text-sm text-gray-600">... and {results.productCount - 5} more products</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}