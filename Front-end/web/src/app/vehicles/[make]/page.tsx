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
    // Navigate directly to the WordPress-based vehicle parts page
    router.push(`/vehicles/${make}/wordpress-page`);
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
          <div className="text-center mb-12">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Available {vehicleMake} Models</h3>
            <div className="flex flex-wrap justify-center gap-4 mb-8">
              {vehicles.map((vehicle) => (
                <span 
                  key={vehicle._id}
                  className="bg-blue-100 text-blue-800 px-4 py-2 rounded-full text-sm font-medium"
                >
                  {vehicle.model}
                </span>
              ))}
            </div>
            <button 
              onClick={goToVehicleParts}
              className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors text-lg font-medium"
            >
              Browse Parts for {vehicleMake}
            </button>
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