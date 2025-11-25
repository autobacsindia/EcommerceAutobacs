'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import apiClient from '@/lib/api';

interface VehicleMake {
  _id: string;
  name: string;
  slug: string;
}

export default function VehiclesPage() {
  const [makes, setMakes] = useState<VehicleMake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMakes = async () => {
      try {
        setLoading(true);
        const response: any = await apiClient.get('/vehicles/makes');
        const makeData = response.makes.map((make: string) => ({
          _id: make,
          name: make,
          slug: make.toLowerCase().replace(/\s+/g, '-')
        }));
        setMakes(makeData);
      } catch (err) {
        console.error('Failed to fetch vehicle makes:', err);
        setError('Failed to load vehicle makes');
      } finally {
        setLoading(false);
      }
    };

    fetchMakes();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl font-bold mb-4">Vehicle Parts & Accessories</h1>
          <p className="text-xl text-blue-100">
            Find the perfect parts for your vehicle
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Browse by Vehicle Make</h2>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Select your vehicle make to find compatible parts and accessories
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
            {[...Array(12)].map((_, index) => (
              <div key={index} className="bg-white rounded-lg shadow-md overflow-hidden animate-pulse">
                <div className="h-24 bg-gray-200"></div>
                <div className="p-4">
                  <div className="h-4 bg-gray-200 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="bg-white rounded-lg shadow-md p-8 max-w-2xl mx-auto">
              <div className="text-red-500 mb-4">
                <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Vehicles</h2>
              <p className="text-gray-600 mb-6">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        ) : makes.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
            {makes.map((make) => (
              <Link 
                key={make._id} 
                href={`/vehicles/${encodeURIComponent(make.name)}`}
                className="group block bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-shadow"
              >
                <div className="h-24 bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center">
                  <div className="text-white text-2xl font-bold">
                    {make.name.charAt(0)}
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 text-center group-hover:text-blue-600 transition-colors">
                    {make.name}
                  </h3>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">No Vehicles Found</h2>
            <p className="text-gray-600 mb-6">There are currently no vehicles available.</p>
            <Link 
              href="/products" 
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              Browse all products
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}