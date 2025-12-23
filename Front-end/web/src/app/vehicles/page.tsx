'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { vehicleService, type Vehicle } from '@/services/vehicleService';

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        setLoading(true);
        const vehicleData = await vehicleService.getAllVehicles();
        setVehicles(vehicleData);
      } catch (err) {
        console.error('Error fetching vehicles:', err);
        setError('Failed to load vehicles. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchVehicles();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        
        {/* Hero Section */}
        <div className="bg-gradient-to-r from-blue-900 to-black text-white py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-5xl font-bold mb-6">Explore by Vehicle</h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              Find the perfect parts and accessories for your vehicle
            </p>
          </div>
        </div>

        {/* Loading State */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">All Vehicles</h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">
              Select your vehicle make to browse compatible parts and accessories
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-8">
            {[...Array(10)].map((_, index) => (
              <div 
                key={index}
                className="bg-white rounded-xl overflow-hidden shadow-md border border-gray-100 animate-pulse"
              >
                <div className="h-32 bg-gray-200"></div>
                <div className="p-5">
                  <div className="h-6 bg-gray-200 rounded mb-3"></div>
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Error Loading Vehicles</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-900 to-black text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-5xl font-bold mb-6">Explore by Vehicle</h1>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto">
            Find the perfect parts and accessories for your vehicle
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">All Vehicles</h2>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Select your vehicle make to browse compatible parts and accessories
          </p>
        </div>

        {vehicles.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">No vehicles found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {vehicles.map((vehicle) => (
              <Link
                key={vehicle._id}
                href={`/vehicles/${encodeURIComponent(vehicle.slug)}`}
                className="group block"
              >
                <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300">
                  <div className="aspect-square bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center overflow-hidden">
                    <img 
                      src={vehicle.image?.url || `/images/vehicles/${vehicle.slug}.jpg`} 
                      alt={vehicle.name || vehicle.make + ' ' + vehicle.model}
                      className="object-cover w-full h-full scale-110 group-hover:scale-125 transition-transform duration-500"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        // First try SVG fallback, then generic fallback
                        if (target.src.includes('.jpg')) {
                          target.src = `/images/vehicles/${vehicle.slug}.svg`;
                          // Set up another error handler in case SVG also fails
                          target.onerror = () => {
                            target.src = '/images/fallback-product.png';
                          };
                        } else {
                          target.src = '/images/fallback-product.png';
                        }
                      }}
                      loading="lazy"
                    />
                  </div>
                  <div className="p-3 text-center bg-gray-50">
                    <h3 className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                      {vehicle.name}
                    </h3>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}