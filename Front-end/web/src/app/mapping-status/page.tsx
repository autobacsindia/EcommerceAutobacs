'use client';

import { useState, useEffect } from 'react';
import { wordpressService } from '@/services/wordpressService';

export default function MappingStatusPage() {
  const [status, setStatus] = useState({
    vehicles: 0,
    categories: 0,
    testVehicle: '',
    testProducts: 0,
    loading: true,
    error: null as string | null
  });

  useEffect(() => {
    const checkMappingStatus = async () => {
      try {
        setStatus(prev => ({ ...prev, loading: true, error: null }));
        
        // Fetch vehicles
        const vehicles = await wordpressService.getAllVehicles();
        
        // Fetch categories
        const categories = await wordpressService.getProductCategories();
        
        // If we have vehicles, test product fetching
        let testVehicle = '';
        let testProducts = 0;
        if (vehicles.length > 0) {
          testVehicle = vehicles[0].name;
          try {
            const products = await wordpressService.getProductsByVehicle(vehicles[0].slug);
            testProducts = products.products.length;
            console.log(`Test vehicle ${vehicles[0].slug}: Found ${testProducts} products`);
          } catch (error) {
            console.error('Error fetching test products:', error);
          }
        }
        
        setStatus({
          vehicles: vehicles.length,
          categories: categories.length,
          testVehicle,
          testProducts,
          loading: false,
          error: null
        });
      } catch (error: any) {
        setStatus({
          vehicles: 0,
          categories: 0,
          testVehicle: '',
          testProducts: 0,
          loading: false,
          error: error.message || 'Failed to check mapping status'
        });
      }
    };

    checkMappingStatus();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Vehicle-to-Product Mapping Status</h1>
        
        {status.loading ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600">Checking mapping status...</p>
          </div>
        ) : status.error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-red-800 mb-2">Error</h2>
            <p className="text-red-600">{status.error}</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Mapping Status</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border rounded-lg p-4">
                  <h3 className="font-medium text-gray-900 mb-2">Vehicles</h3>
                  <p className="text-3xl font-bold text-blue-600">{status.vehicles}</p>
                  <p className="text-sm text-gray-500">Vehicle models configured</p>
                </div>
                
                <div className="border rounded-lg p-4">
                  <h3 className="font-medium text-gray-900 mb-2">Categories</h3>
                  <p className="text-3xl font-bold text-blue-600">{status.categories}</p>
                  <p className="text-sm text-gray-500">Product categories available</p>
                </div>
                
                {status.testVehicle && (
                  <div className="border rounded-lg p-4 md:col-span-2">
                    <h3 className="font-medium text-gray-900 mb-2">Sample Test</h3>
                    <p className="text-lg">
                      Found <span className="font-bold text-blue-600">{status.testProducts}</span> products 
                      for <span className="font-bold">{status.testVehicle}</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Next Steps</h2>
              <ul className="list-disc pl-5 space-y-2 text-gray-700">
                <li>Visit <a href="/vehicles" className="text-blue-600 hover:underline">/vehicles</a> to browse vehicle models</li>
                <li>Select a vehicle to view compatible products</li>
                <li>Use category filters to narrow down product selections</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}