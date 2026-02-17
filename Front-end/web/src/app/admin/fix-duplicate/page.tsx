'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { toast } from 'react-hot-toast';

export default function FixDuplicatePage() {
  const [product1, setProduct1] = useState<any>(null);
  const [product2, setProduct2] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const targetId = '6969c8fe8674089d04ca8874'; // Newer, has vehicles
  const sourceId = '694e2d1d9be7eca9ee66fe58'; // Older, has features

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      // We handle 404s gracefully in case one is already deleted
      try {
        const p1: any = await apiClient.get(`/products/${targetId}`);
        setProduct1(p1.product);
      } catch (e) {
        console.warn('Target product not found');
      }

      try {
        const p2: any = await apiClient.get(`/products/${sourceId}`);
        setProduct2(p2.product);
      } catch (e) {
        console.warn('Source product not found');
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to fetch products');
    } finally {
      setLoading(false);
    }
  };

  const handleFix = async () => {
    if (!product1 || !product2) return;

    try {
      setLoading(true);
      setStatus('Updating target product...');

      // 1. Update target with features from source if target has none
      if ((!product1.features || product1.features.length === 0) && product2.features && product2.features.length > 0) {
        await apiClient.put(`/products/${targetId}`, {
          features: product2.features
        });
        toast.success('Features copied to target product');
      } else {
        console.log('Target already has features or source has none, skipping update');
      }

      setStatus('Deleting source product...');
      // 2. Delete source
      await apiClient.delete(`/products/${sourceId}`);

      setStatus('Done!');
      toast.success('Duplicate resolved successfully');
      
      // Refresh data
      await fetchProducts();
    } catch (error) {
      console.error(error);
      toast.error('Operation failed');
      setStatus('Error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Duplicate Product Resolver</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="border rounded-lg p-4 bg-white shadow-sm">
          <h2 className="font-bold text-lg mb-2 text-green-700">Target (Keep)</h2>
          <div className="text-sm text-gray-500 mb-2">ID: {targetId}</div>
          {product1 ? (
            <div className="space-y-2">
              <p><strong>Name:</strong> {product1.name}</p>
              <p><strong>Vehicles:</strong> {product1.compatibleVehicles?.length || 0}</p>
              <p><strong>Features:</strong> {product1.features?.length || 0}</p>
              <details>
                <summary className="cursor-pointer text-blue-600">Raw Data</summary>
                <pre className="text-xs overflow-auto h-40 bg-gray-50 p-2 mt-2 rounded">{JSON.stringify(product1, null, 2)}</pre>
              </details>
            </div>
          ) : (
            <p className="text-red-500">Product not found</p>
          )}
        </div>

        <div className="border rounded-lg p-4 bg-white shadow-sm">
          <h2 className="font-bold text-lg mb-2 text-red-700">Source (Delete)</h2>
          <div className="text-sm text-gray-500 mb-2">ID: {sourceId}</div>
          {product2 ? (
            <div className="space-y-2">
              <p><strong>Name:</strong> {product2.name}</p>
              <p><strong>Vehicles:</strong> {product2.compatibleVehicles?.length || 0}</p>
              <p><strong>Features:</strong> {product2.features?.length || 0}</p>
              <details>
                <summary className="cursor-pointer text-blue-600">Raw Data</summary>
                <pre className="text-xs overflow-auto h-40 bg-gray-50 p-2 mt-2 rounded">{JSON.stringify(product2, null, 2)}</pre>
              </details>
            </div>
          ) : (
            <p className="text-gray-500">Product already deleted</p>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-4">
        {status && <p className="font-medium text-blue-600">{status}</p>}
        
        {product1 && product2 && (
          <button
            onClick={handleFix}
            disabled={loading}
            className="bg-red-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 transition-colors shadow-md"
          >
            {loading ? 'Processing...' : 'Merge Features & Delete Duplicate'}
          </button>
        )}
        
        {product1 && !product2 && (
          <div className="p-4 bg-green-50 text-green-700 rounded-lg border border-green-200">
            ✓ Issue Resolved: Duplicate product has been removed.
          </div>
        )}
      </div>
    </div>
  );
}
