'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { Filter } from 'lucide-react';
import { vehicleService, Vehicle } from '@/services/vehicleService';

export default function VehicleMakePage({ params }: { params: Promise<{ make: string }> }) {
  // Unwrap the params Promise
  const paramsValue = use(params);
  const { make } = paramsValue;
  const vehicleMake = decodeURIComponent(make);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch vehicles for the selected make
  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        setLoading(true);
        const allVehicles = await vehicleService.getAllVehicles();
        
        // Filter vehicles by make
        const filteredVehicles = allVehicles.filter(
          vehicle => vehicle.make.toLowerCase() === vehicleMake.toLowerCase()
        );
        
        setVehicles(filteredVehicles);
      } catch (err) {
        console.error('Error fetching vehicles:', err);
        setError('Failed to load vehicles');
      } finally {
        setLoading(false);
      }
    };

    fetchVehicles();
  }, [vehicleMake]);

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-900 to-black text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-5xl font-bold mb-6">{vehicleMake} Models</h1>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto">
            Browse all {vehicleMake} models available
          </p>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <nav className="text-sm text-gray-600">
          <Link href="/" className="hover:text-blue-600 transition-colors">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/vehicles" className="hover:text-blue-600 transition-colors">Vehicles</Link>
          <span className="mx-2">/</span>
          <span className="text-gray-900 font-medium">{vehicleMake}</span>
        </nav>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">{vehicleMake} Models</h2>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Explore all available {vehicleMake} models in our inventory
          </p>
        </div>

        {/* Loading state */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
            <p className="mt-4 text-gray-600">Loading {vehicleMake} models...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="text-red-500 text-xl mb-4">{error}</div>
            <button 
              onClick={() => window.location.reload()}
              className="bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : vehicles.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {vehicles.map((vehicle) => (
              <div 
                key={vehicle._id} 
                className="bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 border border-gray-100"
              >
                <div className="h-48 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center relative overflow-hidden">
                  <img 
                    src={vehicle.image?.url || `/images/vehicles/${vehicle.slug}.jpg`} 
                    alt={`${vehicle.make} ${vehicle.model}`}
                    className="object-cover w-full h-full"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = '/images/vehicles/placeholder.jpg'; // fallback image
                    }}
                  />
                  <div className="absolute inset-0 bg-black bg-opacity-30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity duration-300">
                    <span className="text-white text-lg font-semibold">View Details</span>
                  </div>
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-bold text-gray-900 mb-2">{vehicle.model}</h3>
                  <p className="text-gray-600 mb-1">{vehicle.make}</p>
                  <p className="text-gray-500 text-sm mb-4">Year: {vehicle.year}</p>
                  <div className="flex justify-between items-center">
                    <span className="text-blue-600 font-semibold">Available</span>
                    <Link 
                      href={`/products?vehicle=${vehicle._id}`}
                      className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors text-sm"
                    >
                      View Parts
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg mb-4">No {vehicleMake} models found in our inventory</p>
            <Link 
              href="/vehicles" 
              className="text-blue-600 hover:text-blue-700 font-medium inline-flex items-center"
            >
              Browse all vehicles
              <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}