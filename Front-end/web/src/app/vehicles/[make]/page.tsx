'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Filter } from 'lucide-react';
import { vehicleService, Vehicle } from '@/services/vehicleService';

export default function VehicleMakePage({ params }: { params: Promise<{ make: string }> }) {
  const router = useRouter();
  
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

  // Function to go directly to parts for a vehicle make
  const goToVehicleParts = () => {
    // Navigate to first available vehicle model page or fallback to generic make slug
    if (vehicles.length > 0) {
      router.push(`/model/${encodeURIComponent(vehicles[0].slug)}`);
    } else {
      // Fallback: try with make name as slug
      router.push(`/model/${encodeURIComponent(vehicleMake.toLowerCase().replace(/\s+/g, '-'))}`);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-900 to-black text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-5xl font-bold mb-6">{vehicleMake} Parts & Accessories</h1>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto">
            Find the perfect parts and accessories for your {vehicleMake}
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
          <h2 className="text-3xl font-bold text-gray-900 mb-4">{vehicleMake} Parts & Accessories</h2>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Browse parts and accessories compatible with your {vehicleMake}
          </p>
        </div>

        {/* Loading state */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
            <p className="mt-4 text-gray-600">Loading {vehicleMake} parts...</p>
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
          <div className="mb-12">
            <h3 className="text-2xl font-semibold text-gray-800 mb-6 text-center">Available {vehicleMake} Models</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 mb-8">
              {vehicles.map((vehicle) => (
                <Link
                  key={vehicle._id}
                  href={`/model/${encodeURIComponent(vehicle.slug)}`}
                  className="group block"
                >
                  <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300 border border-gray-100">
                    <div className="aspect-square bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center overflow-hidden">
                      {vehicle.image?.url ? (
                        <img 
                          src={vehicle.image.url} 
                          alt={vehicle.image.alt || `${vehicle.make} ${vehicle.model}`}
                          className="object-cover w-full h-full scale-110 group-hover:scale-125 transition-transform duration-500"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.src = '/images/fallback-product.png';
                          }}
                          loading="lazy"
                        />
                      ) : (
                        <div className="text-gray-400 text-center p-4">
                          <svg className="mx-auto h-12 w-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="p-3 text-center bg-gray-50">
                      <h3 className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                        {vehicle.model}
                      </h3>
                      {vehicle.year && (
                        <p className="text-xs text-gray-500 mt-1">{vehicle.year}</p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            <div className="text-center">
              <button 
                onClick={goToVehicleParts}
                className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors text-lg font-medium"
              >
                Browse All {vehicleMake} Parts
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg mb-6">No specific models found for {vehicleMake}</p>
            <button 
              onClick={goToVehicleParts}
              className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors text-lg font-medium"
            >
              Browse All {vehicleMake} Parts
            </button>
          </div>
        )}
      </div>
    </div>
  );
}